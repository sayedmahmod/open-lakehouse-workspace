"""Multi-task job orchestration.

A job is a directed acyclic graph of tasks. The runner walks it in topological
order, running every task whose dependencies are resolved — in parallel when
the graph allows — and honours the pieces of the task-orchestration model
that this stack can back for real:

* dependency **outcomes** and per-task ``run_if`` rules
  (``ALL_SUCCESS`` / ``ALL_DONE`` / ``NONE_FAILED`` / ``AT_LEAST_ONE_SUCCESS`` /
  ``AT_LEAST_ONE_FAILED`` / ``ALL_FAILED``)
* **condition** tasks with ``true`` / ``false`` branches; the untaken branch and
  everything reachable only through it is marked ``EXCLUDED``
* **for-each** tasks that fan a nested task over a list, optionally concurrently
* **run-job** and **pipeline** tasks that trigger another job or a declarative
  pipeline and wait for it
* per-task **retries** with backoff and per-task / per-job **timeouts** that
  actually interrupt the running Spark job
* **task values** published by one task and referenced by ``{{tasks.k.values.n}}``
  in a later one, plus job/for-each **parameters** via ``{{ ... }}`` templating
* **repair runs** that re-execute only the failed part of a finished run
* **max concurrent runs** with an optional queue
"""
from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait, FIRST_COMPLETED
from datetime import datetime, timezone
from typing import Any

from . import db, notifications, queries, spark, templating

log = logging.getLogger("lakehouse.orchestrator")

TERMINAL = {"SUCCESS", "FAILED", "SKIPPED", "TIMED_OUT", "CANCELED", "EXCLUDED", "UPSTREAM_FAILED"}
FAILISH = {"FAILED", "TIMED_OUT"}
RUN_IF_CHOICES = (
    "ALL_SUCCESS", "ALL_DONE", "NONE_FAILED",
    "AT_LEAST_ONE_SUCCESS", "AT_LEAST_ONE_FAILED", "ALL_FAILED",
)
_MAX_TASK_PARALLELISM = 4


class _Control:
    """Cancellation channel shared between a running job and the API."""

    def __init__(self) -> None:
        self.cancel = threading.Event()
        self.tags: set[str] = set()
        self.lock = threading.Lock()

    def register(self, tag: str) -> None:
        with self.lock:
            self.tags.add(tag)

    def interrupt_all(self) -> None:
        with self.lock:
            tags = list(self.tags)
        for tag in tags:
            spark.cancel_tag(tag)


_active: dict[str, _Control] = {}
_active_lock = threading.Lock()


# --------------------------------------------------------------------- task shape


def normalize_task(task: dict[str, Any]) -> dict[str, Any]:
    """Coerce a stored/incoming task into the canonical shape the runner uses."""
    out = dict(task)
    out.setdefault("key", task.get("name") or "task")
    out.setdefault("name", out["key"])
    out.setdefault("type", "sql")
    out["depends_on"] = _normalize_deps(task.get("depends_on"))
    run_if = str(task.get("run_if") or "ALL_SUCCESS").upper()
    out["run_if"] = run_if if run_if in RUN_IF_CHOICES else "ALL_SUCCESS"
    retry = task.get("retry") or {}
    out["retry"] = {
        "max_retries": max(0, int(retry.get("max_retries", 0) or 0)),
        "min_retry_interval_millis": max(0, int(retry.get("min_retry_interval_millis", 0) or 0)),
        "retry_on_timeout": bool(retry.get("retry_on_timeout", False)),
    }
    out["timeout_seconds"] = max(0, int(task.get("timeout_seconds", 0) or 0))
    out["parameters"] = dict(task.get("parameters") or {})
    out["disabled"] = bool(task.get("disabled", False))
    out["capture_output"] = bool(task.get("capture_output", False))
    return out


def _normalize_deps(raw: Any) -> list[dict[str, str]]:
    deps: list[dict[str, str]] = []
    for dep in raw or []:
        if isinstance(dep, str):
            deps.append({"key": dep, "outcome": "success"})
        elif isinstance(dep, dict) and dep.get("key"):
            outcome = str(dep.get("outcome") or "success").lower()
            deps.append({"key": dep["key"], "outcome": outcome})
    return deps


def validate(tasks: list[dict[str, Any]]) -> list[str]:
    """Structural problems that would stop a job from running."""
    errors: list[str] = []
    norm = [normalize_task(t) for t in tasks]
    keys = [t["key"] for t in norm]
    if not keys:
        return ["a job needs at least one task"]
    seen: set[str] = set()
    for key in keys:
        if key in seen:
            errors.append(f"duplicate task key '{key}'")
        seen.add(key)
    keyset = set(keys)
    for task in norm:
        for dep in task["depends_on"]:
            if dep["key"] not in keyset:
                errors.append(f"task '{task['key']}' depends on unknown task '{dep['key']}'")
            if dep["outcome"] in ("true", "false"):
                upstream = next((t for t in norm if t["key"] == dep["key"]), None)
                if upstream and upstream["type"] != "condition":
                    errors.append(
                        f"task '{task['key']}' expects a {dep['outcome']} branch from '{dep['key']}',"
                        " which is not a condition task"
                    )
        if task["type"] == "condition" and not (task.get("condition") or {}).get("op"):
            errors.append(f"condition task '{task['key']}' has no comparison configured")
        if task["type"] == "for_each" and not task.get("inner_task"):
            errors.append(f"for-each task '{task['key']}' has no nested task")
        if task["type"] == "run_job" and not task.get("run_job_id"):
            errors.append(f"run-job task '{task['key']}' has no target job")
        if task["type"] == "pipeline" and not task.get("pipeline_id"):
            errors.append(f"pipeline task '{task['key']}' has no target pipeline")
    order = _topo_order(norm)
    if len(order) != len(norm):
        errors.append("the task graph contains a cycle")
    return errors


def _topo_order(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key = {t["key"]: t for t in tasks}
    state: dict[str, int] = {}
    ordered: list[dict[str, Any]] = []
    cyclic = False

    def visit(key: str) -> None:
        nonlocal cyclic
        st = state.get(key, 0)
        if st == 1:
            cyclic = True
            return
        if st == 2:
            return
        state[key] = 1
        task = by_key.get(key)
        if task:
            for dep in task["depends_on"]:
                if dep["key"] in by_key:
                    visit(dep["key"])
            ordered.append(task)
        state[key] = 2

    for task in tasks:
        visit(task["key"])
    return [] if cyclic else ordered


# --------------------------------------------------------------------- run lifecycle


def running_count(job_id: str) -> int:
    row = db.query_one(
        "SELECT COUNT(*) AS n FROM job_runs WHERE job_id = ? AND status IN ('RUNNING','QUEUED')",
        (job_id,),
    )
    return int((row or {}).get("n") or 0)


def start_run(
    job_id: str,
    trigger: str = "manual",
    params: dict[str, Any] | None = None,
    *,
    wait: bool = False,
) -> dict[str, Any] | None:
    """Create a run and begin executing it (or queue it). Returns the run row."""
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if not job:
        return None
    tasks = [normalize_task(t) for t in db.loads(job.get("tasks"), []) if not t.get("disabled")]
    if not tasks:
        return None

    resolved = _resolve_params(job, params)
    prev = db.query_one("SELECT MAX(run_number) AS n FROM job_runs WHERE job_id = ?", (job_id,))
    run_number = int((prev or {}).get("n") or 0) + 1
    run_id = db.new_id()
    now = db.now()

    max_concurrent = max(1, int(job.get("max_concurrent_runs") or 1))
    queued = running_count(job_id) >= max_concurrent
    if queued and not bool(job.get("queue_enabled", 1)):
        return None

    task_runs = [_blank_task_run(t) for t in tasks]
    db.execute(
        "INSERT INTO job_runs (id, job_id, run_number, status, trigger, started_at, task_runs,"
        " trigger_params, queued_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (run_id, job_id, run_number, "QUEUED" if queued else "RUNNING", trigger,
         now, db.dumps(task_runs), db.dumps(resolved), now if queued else None),
    )
    if queued:
        log.info("job %s at concurrency limit — run #%s queued", job_id, run_number)
        return db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))

    db.execute("UPDATE jobs SET last_run_at = ? WHERE id = ?", (now, job_id))
    return _launch(run_id, wait=wait)


def _launch(run_id: str, *, wait: bool) -> dict[str, Any] | None:
    if wait:
        _run_worker(run_id)
    else:
        threading.Thread(target=_run_worker, args=(run_id,), name=f"run-{run_id[:8]}", daemon=True).start()
    return db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))


def drain_queue() -> None:
    """Promote queued runs whose job now has spare concurrency. Called each tick."""
    queued = db.query("SELECT * FROM job_runs WHERE status = 'QUEUED' ORDER BY queued_at ASC")
    for run in queued:
        job = db.query_one("SELECT * FROM jobs WHERE id = ?", (run["job_id"],))
        if not job:
            db.execute("UPDATE job_runs SET status='CANCELED', ended_at=? WHERE id=?", (db.now(), run["id"]))
            continue
        running = db.query_one(
            "SELECT COUNT(*) AS n FROM job_runs WHERE job_id = ? AND status = 'RUNNING'", (run["job_id"],)
        )
        if int((running or {}).get("n") or 0) < max(1, int(job.get("max_concurrent_runs") or 1)):
            db.execute("UPDATE job_runs SET status='RUNNING' WHERE id=?", (run["id"],))
            db.execute("UPDATE jobs SET last_run_at = ? WHERE id = ?", (db.now(), run["job_id"]))
            _launch(run["id"], wait=False)


def cancel_run(run_id: str) -> bool:
    run = db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))
    if not run:
        return False
    if run["status"] == "QUEUED":
        db.execute(
            "UPDATE job_runs SET status='CANCELED', ended_at=?, end_state_message=? WHERE id=?",
            (db.now(), "canceled while queued", run_id),
        )
        return True
    with _active_lock:
        control = _active.get(run_id)
    if not control:
        return False
    control.cancel.set()
    control.interrupt_all()
    return True


def repair_run(run_id: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Re-run the failed part of a completed run, in place."""
    run = db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))
    if not run or run["status"] not in ("FAILED", "CANCELED", "SUCCESS"):
        return None
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (run["job_id"],))
    if not job:
        return None
    tasks = [normalize_task(t) for t in db.loads(job.get("tasks"), []) if not t.get("disabled")]
    task_runs = db.loads(run.get("task_runs"), [])
    by_key = {tr["key"]: tr for tr in task_runs}

    failed_keys = {tr["key"] for tr in task_runs if tr["status"] in FAILISH | {"UPSTREAM_FAILED", "SKIPPED", "CANCELED"}}
    if not failed_keys:
        return None
    repair_keys = _with_downstream(tasks, failed_keys)

    for tr in task_runs:
        if tr["key"] in repair_keys:
            tr.update({
                "status": "PENDING", "error": None, "message": None, "started_at": None,
                "ended_at": None, "duration_ms": None, "attempts": [], "query_ids": [],
                "condition_result": None, "iterations": [], "output": {},
            })
    merged = _resolve_params(job, {**db.loads(run.get("trigger_params"), {}), **(params or {})})
    db.execute(
        "UPDATE job_runs SET status='RUNNING', ended_at=NULL, error=NULL, end_state_message=NULL,"
        " repair_count = repair_count + 1, task_runs=?, trigger_params=? WHERE id=?",
        (db.dumps(task_runs), db.dumps(merged), run_id),
    )
    db.execute("UPDATE jobs SET last_run_at = ? WHERE id = ?", (db.now(), run["job_id"]))
    threading.Thread(target=_run_worker, args=(run_id,), kwargs={"repair_keys": repair_keys},
                     name=f"repair-{run_id[:8]}", daemon=True).start()
    return db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))


def _with_downstream(tasks: list[dict[str, Any]], seed: set[str]) -> set[str]:
    children: dict[str, set[str]] = {t["key"]: set() for t in tasks}
    for task in tasks:
        for dep in task["depends_on"]:
            children.setdefault(dep["key"], set()).add(task["key"])
    out = set(seed)
    stack = list(seed)
    while stack:
        for child in children.get(stack.pop(), ()):
            if child not in out:
                out.add(child)
                stack.append(child)
    return out


# --------------------------------------------------------------------- execution


def _run_worker(run_id: str, repair_keys: set[str] | None = None) -> None:
    control = _Control()
    with _active_lock:
        _active[run_id] = control
    try:
        _execute(run_id, control, repair_keys)
    except Exception:  # noqa: BLE001 - a run must always reach a terminal state
        log.exception("run %s crashed", run_id)
        db.execute(
            "UPDATE job_runs SET status='FAILED', ended_at=?, error=? WHERE id=?",
            (db.now(), "orchestrator error — see server log", run_id),
        )
    finally:
        with _active_lock:
            _active.pop(run_id, None)


def _execute(run_id: str, control: _Control, repair_keys: set[str] | None) -> None:
    run = db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (run["job_id"],))
    tasks = _topo_order([normalize_task(t) for t in db.loads(job.get("tasks"), []) if not t.get("disabled")])
    by_key = {t["key"]: t for t in tasks}

    stored_runs = {tr["key"]: tr for tr in db.loads(run.get("task_runs"), [])}
    task_runs: dict[str, dict[str, Any]] = {}
    for task in tasks:
        prior = stored_runs.get(task["key"])
        if repair_keys is not None and prior and task["key"] not in repair_keys:
            task_runs[task["key"]] = prior            # keep the prior outcome untouched
        else:
            task_runs[task["key"]] = _blank_task_run(task)

    params = db.loads(run.get("trigger_params"), {})
    started_at = _parse(run["started_at"]) or datetime.now(timezone.utc)
    job_timeout = int(job.get("timeout_seconds") or 0)
    notify = db.loads(job.get("notifications"), {})

    task_values = _load_task_values(run_id)
    condition_results: dict[str, bool] = {
        k: tr.get("condition_result") for k, tr in task_runs.items() if tr.get("condition_result") is not None
    }

    if repair_keys is None:
        notifications.dispatch(notifications.JOB_START, notify.get("on_start", []), _job_event(job, run, "RUNNING"))

    def states() -> dict[str, str]:
        return {k: tr["status"] for k, tr in task_runs.items()}

    def flush() -> None:
        db.execute("UPDATE job_runs SET task_runs = ? WHERE id = ?",
                   (db.dumps(list(task_runs.values())), run_id))

    def timed_out() -> bool:
        return job_timeout > 0 and (datetime.now(timezone.utc) - started_at).total_seconds() > job_timeout

    pool = ThreadPoolExecutor(max_workers=_MAX_TASK_PARALLELISM, thread_name_prefix="task")
    inflight: dict[Any, str] = {}
    try:
        while True:
            if control.cancel.is_set() or timed_out():
                break
            progressed = False
            for task in tasks:
                key = task["key"]
                tr = task_runs[key]
                if tr["status"] != "PENDING" or key in inflight.values():
                    continue
                deps = task["depends_on"]
                if any(task_runs[d["key"]]["status"] not in TERMINAL for d in deps if d["key"] in task_runs):
                    continue
                decision, message = _gate(task, states(), condition_results)
                if decision == "RUN":
                    if len(inflight) >= _MAX_TASK_PARALLELISM:
                        continue
                    tr["status"] = "RUNNING"
                    tr["started_at"] = db.now()
                    flush()
                    ctx = templating.build_context(
                        job=job, run=run, parameters=params, task_key=key, task_name=task.get("name"),
                        task_values=task_values, task_states=states(), start_time=started_at,
                    )
                    fut = pool.submit(_run_task, job, run, task, ctx, control, dict(task_values))
                    inflight[fut] = key
                else:
                    tr["status"] = decision
                    tr["message"] = message
                    tr["ended_at"] = db.now()
                    tr["duration_ms"] = 0
                    flush()
                progressed = True

            if not inflight:
                if not progressed:
                    break
                continue

            done, _ = futures_wait(list(inflight), timeout=1.0, return_when=FIRST_COMPLETED)
            for fut in done:
                key = inflight.pop(fut)
                result = fut.result()
                task_runs[key].update(result)
                if result.get("condition_result") is not None:
                    condition_results[key] = result["condition_result"]
                for name, value in (result.get("output") or {}).items():
                    task_values.setdefault(key, {})[name] = value
                    _save_task_value(run_id, key, name, value)
                flush()

        if inflight:
            control.cancel.set()
            control.interrupt_all()
            for fut in list(inflight):
                key = inflight.pop(fut)
                try:
                    task_runs[key].update(fut.result(timeout=30))
                except Exception:  # noqa: BLE001
                    task_runs[key].update({"status": "CANCELED", "ended_at": db.now()})
    finally:
        pool.shutdown(wait=False)

    # Anything still pending after we stopped is canceled or blocked.
    for tr in task_runs.values():
        if tr["status"] in ("PENDING", "RUNNING"):
            tr["status"] = "CANCELED" if control.cancel.is_set() else "SKIPPED"
            tr["ended_at"] = tr.get("ended_at") or db.now()

    final = _roll_up(list(task_runs.values()), control, timed_out())
    duration = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
    message = None
    if final == "FAILED" and timed_out():
        message = f"job exceeded its {job_timeout}s timeout"
    elif final == "CANCELED":
        message = "run canceled"
    error_text = next((f"{tr['key']}: {tr['error']}" for tr in task_runs.values() if tr.get("error")), None)
    db.execute(
        "UPDATE job_runs SET status=?, ended_at=?, duration_ms=?, task_runs=?, error=?, end_state_message=? WHERE id=?",
        (final, db.now(), duration, db.dumps(list(task_runs.values())), error_text, message, run_id),
    )

    run_after = db.query_one("SELECT * FROM job_runs WHERE id = ?", (run_id,))
    if final == "SUCCESS":
        notifications.dispatch(notifications.JOB_SUCCESS, notify.get("on_success", []), _job_event(job, run_after, final))
    else:
        notifications.dispatch(notifications.JOB_FAILURE, notify.get("on_failure", []), _job_event(job, run_after, final))
    warn_after = int(notify.get("min_duration_warning_seconds", 0) or 0)
    if warn_after and duration > warn_after * 1000:
        notifications.dispatch(
            notifications.JOB_DURATION_WARNING, notify.get("on_duration_warning", []),
            {**_job_event(job, run_after, final), "duration_ms": duration, "threshold_seconds": warn_after},
        )

    if bool(job.get("continuous")) and not job.get("paused") and not control.cancel.is_set():
        delay = 30 if final != "SUCCESS" else 2
        threading.Timer(delay, lambda: start_run(job["id"], "continuous")).start()


def _gate(task: dict[str, Any], states: dict[str, str], conditions: dict[str, bool]) -> tuple[str, str | None]:
    deps = task["depends_on"]
    if not deps:
        return "RUN", None

    considered: list[str] = []
    for dep in deps:
        dep_state = states.get(dep["key"])
        if dep_state == "EXCLUDED":
            return "EXCLUDED", f"upstream '{dep['key']}' was excluded"
        if dep["outcome"] in ("true", "false"):
            want = dep["outcome"] == "true"
            got = conditions.get(dep["key"])
            if got is None:
                return "EXCLUDED", f"'{dep['key']}' produced no branch result"
            if got is not want:
                return "EXCLUDED", f"'{dep['key']}' took the {'true' if got else 'false'} branch"
            continue
        considered.append(dep_state or "SKIPPED")

    if not considered:
        return "RUN", None
    ok = {s for s in considered if s == "SUCCESS"}
    bad = {s for s in considered if s in FAILISH}
    rule = task["run_if"]
    satisfied = {
        "ALL_SUCCESS": len(ok) == len(considered),
        "ALL_DONE": True,
        "NONE_FAILED": not bad,
        "AT_LEAST_ONE_SUCCESS": bool(ok),
        "AT_LEAST_ONE_FAILED": bool(bad),
        "ALL_FAILED": len(bad) == len(considered),
    }.get(rule, len(ok) == len(considered))
    if satisfied:
        return "RUN", None
    return "SKIPPED", f"run_if {rule} not satisfied"


def _roll_up(task_runs: list[dict[str, Any]], control: _Control, timed_out: bool) -> str:
    statuses = {tr["status"] for tr in task_runs}
    if control.cancel.is_set() and not timed_out and "CANCELED" in statuses:
        return "CANCELED"
    if statuses & FAILISH:
        return "FAILED"
    if "CANCELED" in statuses:
        return "CANCELED"
    return "SUCCESS"


# --------------------------------------------------------------------- one task


def _run_task(
    job: dict[str, Any],
    run: dict[str, Any],
    task: dict[str, Any],
    ctx: dict[str, Any],
    control: _Control,
    task_values: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    kind = task["type"]
    handlers = {
        "sql": _run_statements,
        "saved_query": _run_statements,
        "notebook": _run_statements,
        "dashboard": _run_statements,
        "condition": _run_condition,
        "for_each": _run_for_each,
        "run_job": _run_nested_job,
        "pipeline": _run_pipeline,
    }
    handler = handlers.get(kind, _run_statements)
    t0 = time.perf_counter()
    try:
        result = handler(job, run, task, ctx, control, task_values)
    except Exception as exc:  # noqa: BLE001
        log.exception("task %s failed", task["key"])
        result = {"status": "FAILED", "error": str(exc)}
    result.setdefault("attempts", result.get("attempts", []))
    result["ended_at"] = db.now()
    result["duration_ms"] = int((time.perf_counter() - t0) * 1000)
    return result


def _attempt_loop(task: dict[str, Any], control: _Control, once) -> dict[str, Any]:
    """Run ``once()`` with the task's retry policy. ``once`` returns a result dict."""
    retry = task["retry"]
    attempts: list[dict[str, Any]] = []
    last: dict[str, Any] = {}
    for n in range(retry["max_retries"] + 1):
        if control.cancel.is_set():
            return {"status": "CANCELED", "attempts": attempts, "error": "canceled before attempt"}
        a0 = time.perf_counter()
        started = db.now()
        last = once()
        attempts.append({
            "n": n + 1, "status": last["status"], "started_at": started, "ended_at": db.now(),
            "duration_ms": int((time.perf_counter() - a0) * 1000), "error": last.get("error"),
        })
        if last["status"] == "SUCCESS":
            break
        if last["status"] == "TIMED_OUT" and not retry["retry_on_timeout"]:
            break
        if last["status"] == "CANCELED":
            break
        if n < retry["max_retries"]:
            time.sleep(max(0.0, retry["min_retry_interval_millis"] / 1000.0))
    last["attempts"] = attempts
    return last


def _statements_for(task: dict[str, Any]) -> list[str]:
    kind = task["type"]
    if kind == "notebook":
        nb = db.query_one("SELECT * FROM notebooks WHERE id = ?", (task.get("notebook_id"),))
        if not nb:
            raise RuntimeError("notebook task points at a notebook that no longer exists")
        out: list[str] = []
        for cell in db.loads(nb.get("cells"), []):
            if cell.get("language", "sql") == "sql" and cell.get("source", "").strip():
                out.extend(spark.split_statements(cell["source"]))
        return out
    if kind == "saved_query":
        saved = db.query_one("SELECT * FROM saved_queries WHERE id = ?", (task.get("query_id"),))
        if not saved:
            raise RuntimeError("saved-query task points at a query that no longer exists")
        return spark.split_statements(saved["sql"])
    if kind == "dashboard":
        dash = db.query_one("SELECT * FROM dashboards WHERE id = ?", (task.get("dashboard_id"),))
        if not dash:
            raise RuntimeError("dashboard task points at a dashboard that no longer exists")
        stmts: list[str] = []
        for ds in db.loads(dash.get("datasets"), []):
            if ds.get("sql", "").strip():
                stmts.extend(spark.split_statements(ds["sql"]))
        return stmts
    return spark.split_statements(task.get("sql", ""))


def _run_statements(job, run, task, ctx, control, task_values) -> dict[str, Any]:
    raw = _statements_for(task)
    if not raw:
        return {"status": "SUCCESS", "row_count": 0, "query_ids": [], "message": "no statements to run"}
    timeout = task["timeout_seconds"] or None
    run_id = run["id"]

    def once() -> dict[str, Any]:
        query_ids: list[str] = []
        rows_total = 0
        last_finished: dict[str, Any] | None = None
        for i, stmt_raw in enumerate(raw):
            if control.cancel.is_set():
                return {"status": "CANCELED", "query_ids": query_ids, "row_count": rows_total, "error": "canceled"}
            stmt = templating.render(stmt_raw, ctx)
            tag = f"{run_id}:{task['key']}:{i}:{int(time.time()*1000)}"
            control.register(tag)
            outcome = queries.run_tagged(
                stmt, tag=tag, source="job", source_id=f"{job['id']}:{run_id}:{task['key']}", timeout_s=timeout,
            )
            query_ids.append(outcome["id"])
            if outcome["status"] != "FINISHED":
                return {
                    "status": outcome["status"] if outcome["status"] in ("TIMED_OUT", "CANCELED") else "FAILED",
                    "query_ids": query_ids, "row_count": rows_total,
                    "error": outcome.get("error") or "statement failed",
                }
            rows_total += outcome.get("row_count", 0)
            last_finished = outcome
        output: dict[str, Any] = {}
        if task["capture_output"] and last_finished and last_finished.get("rows"):
            cols = [c["name"] for c in last_finished.get("columns", [])]
            first = last_finished["rows"][0]
            output = {cols[j]: first[j] for j in range(min(len(cols), len(first)))}
        return {"status": "SUCCESS", "query_ids": query_ids, "row_count": rows_total, "output": output}

    return _attempt_loop(task, control, once)


def _run_condition(job, run, task, ctx, control, task_values) -> dict[str, Any]:
    cond = task.get("condition") or {}
    left = templating.render(str(cond.get("left", "")), ctx)
    right = templating.render(str(cond.get("right", "")), ctx)
    op = cond.get("op", "==")
    result = _compare(left, op, right)
    return {
        "status": "SUCCESS",
        "condition_result": result,
        "message": f"{left!r} {op} {right!r} → {result}",
        "output": {"result": "true" if result else "false"},
    }


def _run_for_each(job, run, task, ctx, control, task_values) -> dict[str, Any]:
    spec = task.get("for_each") or {}
    inner = normalize_task(task["inner_task"])
    rendered = templating.render(str(spec.get("inputs", "[]")).strip() or "[]", ctx)
    try:
        items = json.loads(rendered)
    except json.JSONDecodeError as exc:
        return {"status": "FAILED", "error": f"for-each inputs are not valid JSON: {exc}"}
    if not isinstance(items, list):
        return {"status": "FAILED", "error": "for-each inputs must be a JSON array"}
    if not items:
        return {"status": "SUCCESS", "iterations": [], "message": "no items to iterate"}

    concurrency = min(8, max(1, int(spec.get("concurrency", 1) or 1)))
    iterations: list[dict[str, Any]] = [None] * len(items)  # type: ignore[list-item]

    def run_one(index: int, item: Any) -> None:
        i0 = time.perf_counter()
        loop_ctx = templating.build_context(
            job=job, run=run, parameters=ctx["parameters"], task_key=f"{task['key']}[{index}]",
            task_name=inner.get("name"), task_values=task_values, task_states=ctx["task_states"],
            loop_input=item, start_time=ctx["start_time"],
        )
        res = _run_task(job, run, inner, loop_ctx, control, task_values)
        iterations[index] = {
            "index": index, "input": item, "status": res["status"],
            "duration_ms": int((time.perf_counter() - i0) * 1000),
            "error": res.get("error"), "row_count": res.get("row_count", 0),
        }

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="foreach") as pool:
        for fut in [pool.submit(run_one, i, it) for i, it in enumerate(items)]:
            fut.result()

    failed = [it for it in iterations if it and it["status"] in FAILISH | {"FAILED"}]
    canceled = any(it and it["status"] == "CANCELED" for it in iterations)
    status = "SUCCESS"
    if canceled:
        status = "CANCELED"
    elif failed:
        status = "FAILED"
    return {
        "status": status,
        "iterations": iterations,
        "row_count": sum(it["row_count"] for it in iterations if it),
        "error": f"{len(failed)} of {len(items)} iterations failed" if failed else None,
        "message": f"{len(items) - len(failed)}/{len(items)} iterations succeeded",
    }


def _run_nested_job(job, run, task, ctx, control, task_values) -> dict[str, Any]:
    target_id = task.get("run_job_id")
    if target_id == job["id"]:
        return {"status": "FAILED", "error": "a run-job task cannot trigger its own job"}
    params = templating.render_params(task["parameters"], ctx)
    nested = start_run(target_id, trigger=f"task:{run['id']}", params=params, wait=False)
    if not nested:
        return {"status": "FAILED", "error": "target job could not be started (missing, or no tasks)"}
    nested_id = nested["id"]
    while not control.cancel.is_set():
        row = db.query_one("SELECT status FROM job_runs WHERE id = ?", (nested_id,))
        if row and row["status"] in TERMINAL | {"SUCCESS", "FAILED", "CANCELED"} and row["status"] not in ("RUNNING", "QUEUED"):
            mapped = "SUCCESS" if row["status"] == "SUCCESS" else row["status"]
            return {
                "status": mapped if mapped in TERMINAL else "FAILED",
                "output": {"run_id": nested_id},
                "message": f"child run finished: {row['status']}",
                "error": None if mapped == "SUCCESS" else f"child job run {row['status'].lower()}",
            }
        time.sleep(1.0)
    cancel_run(nested_id)
    return {"status": "CANCELED", "output": {"run_id": nested_id}, "error": "canceled with parent"}


def _run_pipeline(job, run, task, ctx, control, task_values) -> dict[str, Any]:
    from . import pipelines  # local import: pipelines imports this module for its job task
    full_refresh = bool((task.get("parameters") or {}).get("full_refresh") in ("true", "1", True))
    update = pipelines.start_update(
        task.get("pipeline_id"), cause=f"job:{run['id']}", full_refresh=full_refresh, wait=False,
    )
    if not update:
        return {"status": "FAILED", "error": "target pipeline could not be started"}
    update_id = update["id"]
    while not control.cancel.is_set():
        row = db.query_one("SELECT status FROM pipeline_updates WHERE id = ?", (update_id,))
        if row and row["status"] in ("COMPLETED", "FAILED", "CANCELED"):
            return {
                "status": "SUCCESS" if row["status"] == "COMPLETED" else row["status"],
                "output": {"update_id": update_id},
                "message": f"pipeline update {row['status'].lower()}",
                "error": None if row["status"] == "COMPLETED" else f"pipeline update {row['status'].lower()}",
            }
        time.sleep(1.0)
    pipelines.stop_update(update_id)
    return {"status": "CANCELED", "output": {"update_id": update_id}, "error": "canceled with parent"}


# --------------------------------------------------------------------- helpers


def _blank_task_run(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": task["key"],
        "name": task.get("name") or task["key"],
        "type": task["type"],
        "status": "PENDING",
        "depends_on": task["depends_on"],
        "run_if": task["run_if"],
        "started_at": None,
        "ended_at": None,
        "duration_ms": None,
        "attempts": [],
        "query_ids": [],
        "row_count": None,
        "output": {},
        "condition_result": None,
        "iterations": [],
        "error": None,
        "message": None,
        "cluster": "Spark Connect",
    }


def _resolve_params(job: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    defaults = {p["name"]: p.get("default", "") for p in db.loads(job.get("parameters"), []) if p.get("name")}
    defaults.update({k: v for k, v in (overrides or {}).items()})
    return defaults


def _compare(left: Any, op: str, right: Any) -> bool:
    try:
        lf, rf = float(left), float(right)
        left_cmp, right_cmp = lf, rf
    except (TypeError, ValueError):
        left_cmp, right_cmp = str(left), str(right)
    return {
        "==": left_cmp == right_cmp,
        "!=": left_cmp != right_cmp,
        ">": left_cmp > right_cmp,
        ">=": left_cmp >= right_cmp,
        "<": left_cmp < right_cmp,
        "<=": left_cmp <= right_cmp,
    }.get(op, False)


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _load_task_values(run_id: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in db.query("SELECT task_key, name, value FROM task_values WHERE run_id = ?", (run_id,)):
        out.setdefault(row["task_key"], {})[row["name"]] = db.loads(row["value"], row["value"])
    return out


def _save_task_value(run_id: str, task_key: str, name: str, value: Any) -> None:
    db.execute(
        "INSERT INTO task_values (run_id, task_key, name, value, set_at) VALUES (?,?,?,?,?)"
        " ON CONFLICT(run_id, task_key, name) DO UPDATE SET value = excluded.value, set_at = excluded.set_at",
        (run_id, task_key, name, db.dumps(value), db.now()),
    )


def _job_event(job: dict[str, Any], run: dict[str, Any], state: str) -> dict[str, Any]:
    return {
        "subject_kind": "job",
        "subject_id": job["id"],
        "job_id": job["id"],
        "job_name": job["name"],
        "run_id": run["id"],
        "run_number": run["run_number"],
        "state": state,
        "trigger": run.get("trigger"),
        "started_at": run.get("started_at"),
        "ended_at": run.get("ended_at"),
    }
