"""Declarative pipelines — datasets defined as Spark SQL and materialised in order.

A pipeline is a set of dataset definitions (materialized views, streaming tables
and temporary views). The engine infers the dependency graph from the SQL,
orders it, and on each *update* rebuilds every dataset in order:

* **materialized view** → ``CREATE OR REPLACE TABLE … AS <query>`` (full recompute)
* **streaming table** → first build / full refresh recomputes; later triggered
  updates ``INSERT`` only rows past the high-water mark of ``incremental_key``
* **view** → a session-scoped ``CREATE OR REPLACE TEMP VIEW`` other datasets read

**Expectations** — ``{name, condition, action}`` with ``action`` one of
``warn`` (track only), ``drop`` (filter offending rows out of the write) or
``fail`` (abort the update). Every update records per-dataset row counts and
per-expectation pass / fail / dropped counts, plus an event log.

**Development vs production** — production validates every dataset query
(``EXPLAIN``) before touching any table and retries a failed dataset twice with
backoff; development runs straight away and fails fast.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

from . import db, notifications, spark
from .config import settings

log = logging.getLogger("lakehouse.pipelines")

DATASET_TYPES = ("materialized_view", "streaming_table", "view")
EXPECTATION_ACTIONS = ("warn", "drop", "fail")

_cancels: dict[str, threading.Event] = {}
_cancels_lock = threading.Lock()


# --------------------------------------------------------------------- shapes


def normalize_dataset(ds: dict[str, Any]) -> dict[str, Any]:
    kind = str(ds.get("type") or "materialized_view").lower()
    return {
        "name": (ds.get("name") or "").strip(),
        "type": kind if kind in DATASET_TYPES else "materialized_view",
        "comment": ds.get("comment") or "",
        "sql": ds.get("sql") or "",
        "partition_cols": [c for c in (ds.get("partition_cols") or []) if c],
        "incremental_key": (ds.get("incremental_key") or "").strip(),
        "expectations": [
            {
                "name": (e.get("name") or f"expectation_{i}").strip(),
                "condition": (e.get("condition") or "").strip(),
                "action": e["action"] if e.get("action") in EXPECTATION_ACTIONS else "warn",
            }
            for i, e in enumerate(ds.get("expectations") or [])
            if (e.get("condition") or "").strip()
        ],
    }


def validate(pipeline: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    datasets = [normalize_dataset(d) for d in db.loads(pipeline.get("datasets"), [])]
    if not datasets:
        return ["a pipeline needs at least one dataset"]
    if not pipeline.get("target_catalog") or not pipeline.get("target_schema"):
        errors.append("set a target catalog and schema before running the pipeline")
    seen: set[str] = set()
    for ds in datasets:
        if not ds["name"]:
            errors.append("a dataset has no name")
        elif not re.fullmatch(r"[A-Za-z_][\w]*", ds["name"]):
            errors.append(f"'{ds['name']}' is not a valid dataset name")
        if ds["name"].lower() in seen:
            errors.append(f"duplicate dataset '{ds['name']}'")
        seen.add(ds["name"].lower())
        if not ds["sql"].strip():
            errors.append(f"dataset '{ds['name']}' has no query")
        if ds["type"] == "streaming_table" and not ds["incremental_key"]:
            # allowed, but the operator should know it will full-recompute
            pass
    _, cyclic = _order(datasets)
    if cyclic:
        errors.append("the dataset graph contains a cycle")
    return errors


def _order(datasets: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    by_name = {d["name"].lower(): d for d in datasets}
    deps = {d["name"].lower(): _dataset_deps(d, by_name) for d in datasets}
    state: dict[str, int] = {}
    ordered: list[dict[str, Any]] = []
    cyclic = False

    def visit(name: str) -> None:
        nonlocal cyclic
        st = state.get(name, 0)
        if st == 1:
            cyclic = True
            return
        if st == 2:
            return
        state[name] = 1
        for dep in deps.get(name, ()):
            visit(dep)
        if name in by_name:
            ordered.append(by_name[name])
        state[name] = 2

    for d in datasets:
        visit(d["name"].lower())
    return (ordered, cyclic)


def _dataset_deps(ds: dict[str, Any], by_name: dict[str, dict[str, Any]]) -> set[str]:
    refs = spark.referenced_tables(ds["sql"])
    out: set[str] = set()
    for ref in refs:
        last = ref.split(".")[-1].lower()
        if last in by_name and last != ds["name"].lower():
            out.add(last)
    return out


# --------------------------------------------------------------------- updates


def start_update(
    pipeline_id: str,
    cause: str = "manual",
    *,
    full_refresh: bool = False,
    refresh_selection: list[str] | None = None,
    wait: bool = False,
) -> dict[str, Any] | None:
    pipeline = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pipeline_id,))
    if not pipeline:
        return None
    running = db.query_one(
        "SELECT id FROM pipeline_updates WHERE pipeline_id = ? AND status IN ('QUEUED','RUNNING')",
        (pipeline_id,),
    )
    if running:
        return db.query_one("SELECT * FROM pipeline_updates WHERE id = ?", (running["id"],))

    prev = db.query_one("SELECT MAX(update_number) AS n FROM pipeline_updates WHERE pipeline_id = ?", (pipeline_id,))
    number = int((prev or {}).get("n") or 0) + 1
    update_id = db.new_id()
    now = db.now()
    datasets = [normalize_dataset(d) for d in db.loads(pipeline.get("datasets"), [])]
    dataset_runs = [
        {"name": d["name"], "type": d["type"], "status": "PENDING", "rows": None,
         "duration_ms": None, "expectations": [], "error": None}
        for d in datasets
    ]
    db.execute(
        "INSERT INTO pipeline_updates (id, pipeline_id, update_number, status, cause, full_refresh,"
        " refresh_selection, development, started_at, datasets, events)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (update_id, pipeline_id, number, "RUNNING", cause, 1 if full_refresh else 0,
         db.dumps(refresh_selection or []), int(pipeline.get("development", 1)),
         now, db.dumps(dataset_runs), db.dumps([])),
    )
    db.execute("UPDATE pipelines SET last_update_at = ? WHERE id = ?", (now, pipeline_id))

    if wait:
        _run_update(update_id)
    else:
        threading.Thread(target=_run_update, args=(update_id,), name=f"pl-{update_id[:8]}", daemon=True).start()
    return db.query_one("SELECT * FROM pipeline_updates WHERE id = ?", (update_id,))


def stop_update(update_id: str) -> bool:
    with _cancels_lock:
        ev = _cancels.get(update_id)
    row = db.query_one("SELECT status FROM pipeline_updates WHERE id = ?", (update_id,))
    if not row:
        return False
    if row["status"] not in ("RUNNING", "QUEUED"):
        return False
    if ev:
        ev.set()
    else:
        db.execute(
            "UPDATE pipeline_updates SET status='CANCELED', ended_at=? WHERE id=?", (db.now(), update_id)
        )
    return True


def _run_update(update_id: str) -> None:
    cancel = threading.Event()
    with _cancels_lock:
        _cancels[update_id] = cancel
    try:
        _run_update_inner(update_id, cancel)
    except Exception:  # noqa: BLE001
        log.exception("pipeline update %s crashed", update_id)
        db.execute(
            "UPDATE pipeline_updates SET status='FAILED', ended_at=?, error=? WHERE id=?",
            (db.now(), "pipeline engine error — see server log", update_id),
        )
    finally:
        with _cancels_lock:
            _cancels.pop(update_id, None)


def _run_update_inner(update_id: str, cancel: threading.Event) -> None:
    update = db.query_one("SELECT * FROM pipeline_updates WHERE id = ?", (update_id,))
    pipeline = db.query_one("SELECT * FROM pipelines WHERE id = ?", (update["pipeline_id"],))
    started = datetime.now(timezone.utc)
    events: list[dict[str, Any]] = []
    dataset_runs: dict[str, dict[str, Any]] = {r["name"]: r for r in db.loads(update.get("datasets"), [])}

    def emit(level: str, message: str, dataset: str | None = None) -> None:
        events.append({"ts": db.now(), "level": level, "dataset": dataset, "message": message})
        db.execute("UPDATE pipeline_updates SET events = ? WHERE id = ?", (db.dumps(events), update_id))

    def flush_datasets() -> None:
        db.execute("UPDATE pipeline_updates SET datasets = ? WHERE id = ?",
                   (db.dumps(list(dataset_runs.values())), update_id))

    problems = validate(pipeline)
    if problems:
        emit("ERROR", "; ".join(problems))
        _finish(update_id, "FAILED", started, "; ".join(problems), events)
        _notify(pipeline, update_id, "FAILED")
        return

    catalog = pipeline["target_catalog"]
    schema = pipeline["target_schema"]
    config = db.loads(pipeline.get("configuration"), {})
    development = bool(pipeline.get("development", 1))
    full_refresh = bool(update.get("full_refresh"))
    selection = set(db.loads(update.get("refresh_selection"), []) or [])

    datasets = [normalize_dataset(d) for d in db.loads(pipeline.get("datasets"), [])]
    ordered, cyclic = _order(datasets)
    if cyclic:
        emit("ERROR", "dataset graph contains a cycle")
        _finish(update_id, "FAILED", started, "dataset graph contains a cycle", events)
        _notify(pipeline, update_id, "FAILED")
        return

    by_name = {d["name"].lower(): d for d in datasets}
    upstreams = {d["name"].lower(): _dataset_deps(d, by_name) for d in datasets}
    # Only table-backed datasets get their references qualified; `view` datasets
    # materialise as session temp views resolved by their bare name.
    table_names = {d["name"].lower() for d in datasets if d["type"] != "view"}
    run_set = _run_set(ordered, upstreams, selection)

    emit("INFO", f"update started — {len(run_set)} of {len(datasets)} datasets, "
                 f"{'full refresh' if full_refresh else 'incremental'}, "
                 f"{'development' if development else 'production'} mode")

    if not development:
        for ds in ordered:
            if ds["name"].lower() not in run_set:
                continue
            sql = _qualify(_substitute(ds["sql"], config), table_names - {ds["name"].lower()}, catalog, schema)
            probe = spark.run_sql(f"EXPLAIN {sql}")
            plan = " ".join(str(r[0]) for r in probe.get("rows", []))
            if not plan or "cannot" in plan.lower() or "AnalysisException" in plan:
                emit("ERROR", "validation failed", ds["name"])
                _mark_rest(dataset_runs, ordered, ds["name"], "SKIPPED")
                flush_datasets()
                _finish(update_id, "FAILED", started, f"validation of '{ds['name']}' failed", events)
                _notify(pipeline, update_id, "FAILED")
                return

    failed = False
    for ds in ordered:
        name = ds["name"]
        run = dataset_runs[name]
        if name.lower() not in run_set:
            run["status"] = "EXCLUDED"
            flush_datasets()
            continue
        if cancel.is_set():
            run["status"] = "CANCELED"
            flush_datasets()
            continue
        bad_upstream = [u for u in upstreams[name.lower()]
                        if u in run_set and dataset_runs.get(by_name[u]["name"], {}).get("status") in ("FAILED", "SKIPPED")]
        if bad_upstream:
            run["status"] = "SKIPPED"
            run["error"] = f"upstream dataset(s) failed: {', '.join(bad_upstream)}"
            emit("WARN", run["error"], name)
            flush_datasets()
            continue

        run["status"] = "RUNNING"
        flush_datasets()
        emit("INFO", f"materializing {ds['type'].replace('_', ' ')}", name)
        attempts = 1 if development else 3
        result: dict[str, Any] = {}
        for attempt in range(attempts):
            if cancel.is_set():
                break
            result = _materialize(ds, catalog, schema, config, full_refresh, cancel, emit,
                                  siblings=table_names - {name.lower()})
            if result["status"] == "SUCCESS" or result["status"] == "CANCELED":
                break
            if attempt < attempts - 1:
                emit("WARN", f"attempt {attempt + 1} failed ({result.get('error')}); retrying", name)
                time.sleep(2 * (attempt + 1))

        run.update({
            "status": result.get("status", "FAILED"),
            "rows": result.get("rows"),
            "rows_written": result.get("rows_written"),
            "duration_ms": result.get("duration_ms"),
            "expectations": result.get("expectations", []),
            "error": result.get("error"),
            "query_ids": result.get("query_ids", []),
        })
        flush_datasets()
        for exp in result.get("expectations", []):
            if exp["failed"]:
                emit("WARN" if exp["action"] != "fail" else "ERROR",
                     f"expectation '{exp['name']}' — {exp['failed']} of {exp['total']} rows violate "
                     f"({exp['action']})", name)
        if result["status"] == "SUCCESS":
            emit("INFO", f"wrote {result.get('rows_written', result.get('rows', 0))} rows", name)
        elif result["status"] == "CANCELED":
            emit("WARN", "canceled", name)
        else:
            failed = True
            emit("ERROR", result.get("error") or "materialization failed", name)
            if not development:
                _mark_rest(dataset_runs, ordered, name, "SKIPPED", run_set)
                flush_datasets()
                break

    canceled = cancel.is_set()
    status = "CANCELED" if canceled else ("FAILED" if failed else "COMPLETED")
    err = None
    if failed:
        err = next((r["error"] for r in dataset_runs.values() if r.get("error")), "one or more datasets failed")
    _finish(update_id, status, started, err, events)
    _notify(pipeline, update_id, status)


def _run_set(ordered, upstreams, selection: set[str]) -> set[str]:
    if not selection:
        return {d["name"].lower() for d in ordered}
    wanted = {s.lower() for s in selection}
    out: set[str] = set()
    stack = list(wanted)
    while stack:
        cur = stack.pop()
        if cur in out:
            continue
        out.add(cur)
        stack.extend(upstreams.get(cur, ()))
    return out


def _materialize(ds, catalog, schema, config, full_refresh, cancel, emit, siblings=None) -> dict[str, Any]:
    t0 = time.perf_counter()
    name = ds["name"]
    full = f"{catalog}.{schema}.{name}"
    user_sql = _substitute(ds["sql"], config).rstrip().rstrip(";")
    user_sql = _qualify(user_sql, siblings or set(), catalog, schema)
    query_ids: list[str] = []

    exp_results, drop_conds = _check_expectations(ds, user_sql)
    fail_hit = next((e for e in exp_results if e["action"] == "fail" and e["failed"]), None)
    if fail_hit:
        return {
            "status": "FAILED", "duration_ms": int((time.perf_counter() - t0) * 1000),
            "expectations": exp_results,
            "error": f"expectation '{fail_hit['name']}' failed on {fail_hit['failed']} row(s)",
        }

    select_sql = f"SELECT * FROM ({user_sql}) __src"
    if drop_conds:
        select_sql += " WHERE " + " AND ".join(f"({c})" for c in drop_conds)

    try:
        if ds["type"] == "view":
            spark.run_sql(f"CREATE OR REPLACE TEMPORARY VIEW {name} AS {select_sql}")
            count = _scalar(f"SELECT count(1) FROM {name}")
            return {"status": "SUCCESS", "rows": count, "rows_written": count,
                    "duration_ms": int((time.perf_counter() - t0) * 1000), "expectations": exp_results,
                    "query_ids": query_ids}

        exists = _table_exists(full)
        incremental = (
            ds["type"] == "streaming_table" and exists and not full_refresh and bool(ds["incremental_key"])
        )
        if incremental:
            key = ds["incremental_key"]
            watermark = _scalar(f"SELECT max({key}) FROM {full}")
            where = f" WHERE {key} > (SELECT max({key}) FROM {full})" if watermark is not None else ""
            before = _scalar(f"SELECT count(1) FROM {full}") or 0
            spark.run_sql(f"INSERT INTO {full} SELECT * FROM ({select_sql}){where}")
            after = _scalar(f"SELECT count(1) FROM {full}") or 0
            return {"status": "SUCCESS", "rows": after, "rows_written": max(0, after - before),
                    "duration_ms": int((time.perf_counter() - t0) * 1000), "expectations": exp_results,
                    "query_ids": query_ids}

        if ds["type"] == "streaming_table" and exists and not full_refresh and not ds["incremental_key"]:
            emit("WARN", "no incremental key — recomputing the whole streaming table", name)
        parts = f" PARTITIONED BY ({', '.join(ds['partition_cols'])})" if ds["partition_cols"] else ""
        comment = f" COMMENT '{ds['comment'].replace(chr(39), chr(39) * 2)}'" if ds["comment"] else ""
        # Unity Catalog OSS rejects managed tables, so materialise as an EXTERNAL
        # Delta table at a deterministic, catalog-local path.
        location = f"{settings.pipeline_storage_root.rstrip('/')}/{schema}/{name}"
        spark.run_sql(
            f"CREATE OR REPLACE TABLE {full}{comment} USING DELTA{parts} "
            f"LOCATION '{location}' AS {select_sql}"
        )
        count = _scalar(f"SELECT count(1) FROM {full}")
        return {"status": "SUCCESS", "rows": count, "rows_written": count,
                "duration_ms": int((time.perf_counter() - t0) * 1000), "expectations": exp_results,
                "query_ids": query_ids}
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        status = "CANCELED" if cancel.is_set() or "cancel" in msg.lower() else "FAILED"
        return {"status": status, "duration_ms": int((time.perf_counter() - t0) * 1000),
                "expectations": exp_results, "error": msg}


def _check_expectations(ds, user_sql: str) -> tuple[list[dict[str, Any]], list[str]]:
    exps = ds["expectations"]
    if not exps:
        return [], []
    parts = ["count(1) AS __total"]
    for i, e in enumerate(exps):
        parts.append(
            f"sum(CASE WHEN NOT ({e['condition']}) OR ({e['condition']}) IS NULL THEN 1 ELSE 0 END) AS __f{i}"
        )
    probe = f"SELECT {', '.join(parts)} FROM ({user_sql}) __src"
    try:
        res = spark.run_sql(probe)
        row = res["rows"][0] if res.get("rows") else []
        cols = [c["name"] for c in res.get("columns", [])]
        data = {cols[j]: row[j] for j in range(min(len(cols), len(row)))}
    except Exception as exc:  # noqa: BLE001
        return [{"name": e["name"], "condition": e["condition"], "action": e["action"],
                 "total": None, "failed": None, "error": str(exc)} for e in exps], []
    total = int(data.get("__total") or 0)
    results: list[dict[str, Any]] = []
    drop_conds: list[str] = []
    for i, e in enumerate(exps):
        failed = int(data.get(f"__f{i}") or 0)
        results.append({
            "name": e["name"], "condition": e["condition"], "action": e["action"],
            "total": total, "failed": failed, "passed": total - failed,
        })
        if e["action"] == "drop":
            # keep only rows the expectation holds for (a false/null condition is dropped)
            drop_conds.append(e["condition"])
    return results, drop_conds


def _substitute(sql: str, config: dict[str, Any]) -> str:
    def repl(match: "re.Match[str]") -> str:
        key = match.group(1)
        return str(config.get(key, match.group(0)))
    return re.sub(r"\$\{([A-Za-z_][\w.]*)\}", repl, sql or "")


def _qualify(sql: str, siblings: set[str], catalog: str, schema: str) -> str:
    """Rewrite bare references to sibling datasets (``orders``) to their fully
    qualified table name (``catalog.schema.orders``), the way DLT resolves
    ``LIVE.`` / pipeline-local names. Already-qualified and dotted references are
    left alone."""
    out = sql or ""
    for name in sorted(siblings, key=len, reverse=True):
        pattern = re.compile(rf"(?<![\w.])({re.escape(name)})(?![\w.])", re.IGNORECASE)
        out = pattern.sub(f"{catalog}.{schema}.{name}", out)
    return out


def _scalar(sql: str) -> Any:
    res = spark.run_sql(sql)
    if res.get("rows"):
        return res["rows"][0][0]
    return None


def _table_exists(full_name: str) -> bool:
    try:
        spark.run_sql(f"DESCRIBE TABLE {full_name}")
        return True
    except Exception:  # noqa: BLE001
        return False


def _mark_rest(dataset_runs, ordered, from_name, status, run_set=None) -> None:
    hit = False
    for ds in ordered:
        if ds["name"] == from_name:
            hit = True
            continue
        if not hit:
            continue
        if run_set is not None and ds["name"].lower() not in run_set:
            continue
        run = dataset_runs.get(ds["name"])
        if run and run["status"] in ("PENDING", "RUNNING"):
            run["status"] = status


def _finish(update_id: str, status: str, started: datetime, error: str | None, events: list[dict[str, Any]]) -> None:
    duration = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    events.append({"ts": db.now(), "level": "INFO" if status == "COMPLETED" else "ERROR",
                   "dataset": None, "message": f"update {status.lower()} in {duration} ms"})
    db.execute(
        "UPDATE pipeline_updates SET status=?, ended_at=?, duration_ms=?, error=?, events=? WHERE id=?",
        (status, db.now(), duration, error, db.dumps(events), update_id),
    )


def _notify(pipeline: dict[str, Any], update_id: str, status: str) -> None:
    settings = db.loads(pipeline.get("notifications"), {})
    event = notifications.PIPELINE_SUCCESS if status == "COMPLETED" else notifications.PIPELINE_FAILURE
    urls = settings.get("on_update_success" if status == "COMPLETED" else "on_update_failure", [])
    notifications.dispatch(event, urls, {
        "subject_kind": "pipeline", "subject_id": pipeline["id"], "pipeline_id": pipeline["id"],
        "pipeline_name": pipeline["name"], "update_id": update_id, "state": status,
    })


# --------------------------------------------------------------------- graph


def graph(pipeline_id: str) -> dict[str, Any]:
    pipeline = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pipeline_id,))
    if not pipeline:
        return {"nodes": [], "edges": []}
    datasets = [normalize_dataset(d) for d in db.loads(pipeline.get("datasets"), [])]
    by_name = {d["name"].lower(): d for d in datasets}
    last = db.query_one(
        "SELECT * FROM pipeline_updates WHERE pipeline_id = ? ORDER BY update_number DESC LIMIT 1",
        (pipeline_id,),
    )
    last_runs = {r["name"]: r for r in db.loads((last or {}).get("datasets"), [])} if last else {}

    nodes = []
    for d in datasets:
        run = last_runs.get(d["name"], {})
        exps = run.get("expectations", []) or []
        nodes.append({
            "name": d["name"],
            "type": d["type"],
            "full_name": f"{pipeline['target_catalog']}.{pipeline['target_schema']}.{d['name']}"
            if pipeline["target_catalog"] and pipeline["target_schema"] else d["name"],
            "comment": d["comment"],
            "expectation_count": len(d["expectations"]),
            "status": run.get("status"),
            "rows": run.get("rows"),
            "rows_written": run.get("rows_written"),
            "duration_ms": run.get("duration_ms"),
            "quality": {
                "total": sum(e.get("total") or 0 for e in exps),
                "failed": sum(e.get("failed") or 0 for e in exps),
            } if exps else None,
        })
    edges = []
    for d in datasets:
        for dep in _dataset_deps(d, by_name):
            edges.append({"source": by_name[dep]["name"], "target": d["name"]})
    return {"nodes": nodes, "edges": edges, "last_update": last["id"] if last else None}
