"""Background ticker: fires schedules and evaluates alerts.

Job and pipeline *execution* lives in :mod:`app.orchestrator` and
:mod:`app.pipelines`; this module only decides *when* something should run. It
ticks every 10 seconds and:

* triggers jobs whose ``next_run_at`` has passed, then recomputes it
* keeps ``continuous`` jobs running
* drains the job run queue when concurrency frees up
* triggers pipelines on their schedule
* evaluates due alerts

Schedules are one of: ``interval`` (every N minutes/hours), ``daily`` (HH:MM),
or ``cron`` (a five-field expression plus a timezone).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from . import cron, db, orchestrator, pipelines, queries

log = logging.getLogger("lakehouse.scheduler")

_stop = threading.Event()
_thread: threading.Thread | None = None

_TICK_SECONDS = 10


def compute_next_run(schedule: dict[str, Any] | None, after: datetime | None = None) -> str | None:
    if not schedule:
        return None
    base = after or datetime.now(timezone.utc)
    kind = schedule.get("kind")
    try:
        if kind == "interval":
            every = max(1, int(schedule.get("every", 15)))
            unit = schedule.get("unit", "minutes")
            delta = timedelta(minutes=every) if unit == "minutes" else timedelta(hours=every)
            return _iso(base + delta)
        if kind == "daily":
            hh, _, mm = str(schedule.get("at", "03:00")).partition(":")
            target = base.replace(hour=int(hh or 3), minute=int(mm or 0), second=0, microsecond=0)
            if target <= base:
                target += timedelta(days=1)
            return _iso(target)
        if kind == "cron":
            expr = cron.Cron(schedule.get("cron", "0 * * * *"), schedule.get("tz", "UTC"))
            return _iso(expr.next_after(base))
    except (cron.CronError, ValueError) as exc:
        log.warning("bad schedule %s: %s", schedule, exc)
        return None
    return None


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


# --------------------------------------------------------------------- alerts


def evaluate_alert(alert_id: str) -> dict[str, Any] | None:
    alert = db.query_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    if not alert:
        return None
    outcome = queries.run_blocking(alert["sql"], source="alert", source_id=alert_id, limit=1)
    checked = db.now()
    state, value, error = "unknown", None, None

    if outcome["status"] != "FINISHED":
        state = "error"
        error = outcome.get("error")
    else:
        columns = [c["name"] for c in outcome.get("columns", [])]
        rows = outcome.get("rows", [])
        if not rows:
            state, error = "error", "query returned no rows"
        else:
            column = alert.get("column_name") or (columns[0] if columns else None)
            if column not in columns:
                state, error = "error", f"column '{column}' not in result"
            else:
                value = rows[0][columns.index(column)]
                state = "triggered" if _compare(value, alert["operator"], alert["threshold"]) else "ok"

    db.execute(
        "UPDATE alerts SET state=?, last_checked_at=?, last_value=?"
        + (", last_triggered_at=?" if state == "triggered" else "")
        + " WHERE id=?",
        (state, checked, str(value), checked, alert_id) if state == "triggered" else (state, checked, str(value), alert_id),
    )
    db.execute(
        "INSERT INTO alert_events (id, alert_id, state, value, checked_at, error) VALUES (?,?,?,?,?,?)",
        (db.new_id(), alert_id, state, str(value), checked, error),
    )
    return {"state": state, "value": value, "checked_at": checked, "error": error}


def _compare(value: Any, operator: str, threshold: str) -> bool:
    try:
        left: Any = float(value)
        right: Any = float(threshold)
    except (TypeError, ValueError):
        left, right = str(value), str(threshold)
    return {
        ">": left > right, ">=": left >= right,
        "<": left < right, "<=": left <= right,
        "==": left == right, "!=": left != right,
    }.get(operator, False)


# --------------------------------------------------------------------- ticker


def _tick() -> None:
    now_dt = datetime.now(timezone.utc)

    for job in db.query("SELECT * FROM jobs WHERE paused = 0"):
        schedule = db.loads(job.get("schedule"), None)
        if bool(job.get("continuous")):
            if not db.query_one(
                "SELECT id FROM job_runs WHERE job_id = ? AND status IN ('RUNNING','QUEUED')", (job["id"],)
            ):
                threading.Thread(target=orchestrator.start_run, args=(job["id"], "continuous"), daemon=True).start()
            continue
        if not schedule:
            continue
        next_run = _parse(job.get("next_run_at"))
        if next_run is None:
            db.execute("UPDATE jobs SET next_run_at = ? WHERE id = ?", (compute_next_run(schedule), job["id"]))
            continue
        if next_run <= now_dt:
            db.execute("UPDATE jobs SET next_run_at = ? WHERE id = ?", (compute_next_run(schedule), job["id"]))
            threading.Thread(target=orchestrator.start_run, args=(job["id"], "scheduled"), daemon=True).start()

    try:
        orchestrator.drain_queue()
    except Exception:  # noqa: BLE001
        log.exception("queue drain failed")

    for pipeline in db.query("SELECT * FROM pipelines WHERE paused = 0"):
        schedule = db.loads(pipeline.get("schedule"), None)
        if not schedule:
            continue
        next_run = _parse(pipeline.get("next_run_at"))
        if next_run is None:
            db.execute("UPDATE pipelines SET next_run_at = ? WHERE id = ?", (compute_next_run(schedule), pipeline["id"]))
            continue
        if next_run <= now_dt:
            db.execute("UPDATE pipelines SET next_run_at = ? WHERE id = ?", (compute_next_run(schedule), pipeline["id"]))
            threading.Thread(target=pipelines.start_update, args=(pipeline["id"], "scheduled"), daemon=True).start()

    for alert in db.query("SELECT * FROM alerts WHERE paused = 0"):
        schedule = db.loads(alert.get("schedule"), None)
        if not schedule:
            continue
        last = _parse(alert.get("last_checked_at"))
        due = last is None or (compute_next_run(schedule, last) or "") <= _iso(now_dt)
        if due:
            threading.Thread(target=evaluate_alert, args=(alert["id"],), daemon=True).start()


def _loop() -> None:
    while not _stop.wait(_TICK_SECONDS):
        try:
            _tick()
        except Exception:  # noqa: BLE001 - the ticker must never die
            log.exception("scheduler tick failed")


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="scheduler", daemon=True)
    _thread.start()
    log.info("scheduler started")


def stop() -> None:
    _stop.set()
