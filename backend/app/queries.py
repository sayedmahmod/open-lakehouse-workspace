"""Asynchronous SQL execution with history, cancellation and lineage capture.

A statement submitted here returns immediately with a query id. The frontend
polls for status, which is what lets the SQL editor show a live "Running"
state and offer a working Cancel button.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from . import db, spark

log = logging.getLogger("lakehouse.queries")

# query_id -> result payload for finished/running statements.
_results: dict[str, dict[str, Any]] = {}
_results_lock = threading.RLock()
_MAX_CACHED = 200


def _remember(query_id: str, payload: dict[str, Any]) -> None:
    with _results_lock:
        _results[query_id] = payload
        if len(_results) > _MAX_CACHED:
            oldest = sorted(_results.items(), key=lambda kv: kv[1].get("_seq", 0))[: len(_results) - _MAX_CACHED]
            for key, _ in oldest:
                _results.pop(key, None)


def get_result(query_id: str) -> dict[str, Any] | None:
    with _results_lock:
        return _results.get(query_id)


_seq = 0
_seq_lock = threading.Lock()


def _next_seq() -> int:
    global _seq
    with _seq_lock:
        _seq += 1
        return _seq


def submit_query(
    sql: str,
    *,
    source: str = "editor",
    source_id: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Start a statement and return its initial (running) record."""
    query_id = db.new_id()
    started = db.now()
    stmt_type = spark.statement_type(sql)
    tables = spark.referenced_tables(sql)

    db.execute(
        "INSERT INTO query_history (id, sql, status, started_at, source, source_id, statement_type, referenced_tables)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (query_id, sql, "RUNNING", started, source, source_id, stmt_type, db.dumps(tables)),
    )

    record = {
        "id": query_id,
        "sql": sql,
        "status": "RUNNING",
        "started_at": started,
        "statement_type": stmt_type,
        "referenced_tables": tables,
        "source": source,
        "source_id": source_id,
        "_seq": _next_seq(),
    }
    _remember(query_id, record)
    spark.submit(_run, query_id, sql, limit)
    return record


def _run(query_id: str, sql: str, limit: int | None) -> None:
    t0 = time.perf_counter()
    try:
        result = spark.run_sql(sql, limit=limit, tag=query_id)
        duration = int((time.perf_counter() - t0) * 1000)
        ended = db.now()
        with _results_lock:
            record = _results.get(query_id, {})
            record.update(
                {
                    "status": "FINISHED",
                    "ended_at": ended,
                    "duration_ms": duration,
                    "columns": result["columns"],
                    "rows": result["rows"],
                    "row_count": result["row_count"],
                    "truncated": result["truncated"],
                    "error": None,
                }
            )
            _results[query_id] = record
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, row_count=? WHERE id=?",
            ("FINISHED", ended, duration, result["row_count"], query_id),
        )
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the editor
        duration = int((time.perf_counter() - t0) * 1000)
        ended = db.now()
        message = str(exc)
        cancelled = "cancelled" in message.lower() or "interrupted" in message.lower()
        status = "CANCELED" if cancelled else "FAILED"
        with _results_lock:
            record = _results.get(query_id, {})
            record.update(
                {
                    "status": status,
                    "ended_at": ended,
                    "duration_ms": duration,
                    "error": message,
                    "columns": [],
                    "rows": [],
                    "row_count": 0,
                    "truncated": False,
                }
            )
            _results[query_id] = record
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, error=? WHERE id=?",
            (status, ended, duration, message, query_id),
        )


def cancel(query_id: str) -> bool:
    record = get_result(query_id)
    if not record or record.get("status") != "RUNNING":
        return False
    return spark.cancel_tag(query_id)


def run_blocking(sql: str, *, source: str = "job", source_id: str | None = None, limit: int | None = None) -> dict[str, Any]:
    """Execute synchronously — used by the job runner and alert evaluator."""
    query_id = db.new_id()
    started = db.now()
    stmt_type = spark.statement_type(sql)
    tables = spark.referenced_tables(sql)
    db.execute(
        "INSERT INTO query_history (id, sql, status, started_at, source, source_id, statement_type, referenced_tables)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (query_id, sql, "RUNNING", started, source, source_id, stmt_type, db.dumps(tables)),
    )
    t0 = time.perf_counter()
    try:
        result = spark.run_sql(sql, limit=limit, tag=query_id)
        duration = int((time.perf_counter() - t0) * 1000)
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, row_count=? WHERE id=?",
            ("FINISHED", db.now(), duration, result["row_count"], query_id),
        )
        return {"id": query_id, "status": "FINISHED", "duration_ms": duration, **result}
    except Exception as exc:  # noqa: BLE001
        duration = int((time.perf_counter() - t0) * 1000)
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, error=? WHERE id=?",
            ("FAILED", db.now(), duration, str(exc), query_id),
        )
        return {"id": query_id, "status": "FAILED", "duration_ms": duration, "error": str(exc), "columns": [], "rows": [], "row_count": 0}


def run_tagged(
    sql: str,
    *,
    tag: str,
    source: str = "job",
    source_id: str | None = None,
    limit: int | None = None,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """Execute one statement under a Spark job tag, honouring a wall-clock timeout.

    On timeout the tag is interrupted so the Spark job actually stops, and the
    result comes back with status ``TIMED_OUT``. Used by the job orchestrator,
    which needs both cancellation and per-task time limits.
    """
    query_id = db.new_id()
    started = db.now()
    stmt_type = spark.statement_type(sql)
    tables = spark.referenced_tables(sql)
    db.execute(
        "INSERT INTO query_history (id, sql, status, started_at, source, source_id, statement_type, referenced_tables)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (query_id, sql, "RUNNING", started, source, source_id, stmt_type, db.dumps(tables)),
    )
    t0 = time.perf_counter()
    future = spark.submit(spark.run_sql, sql, limit=limit, tag=tag)
    try:
        result = future.result(timeout=timeout_s)
        duration = int((time.perf_counter() - t0) * 1000)
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, row_count=? WHERE id=?",
            ("FINISHED", db.now(), duration, result["row_count"], query_id),
        )
        return {"id": query_id, "status": "FINISHED", "duration_ms": duration, **result}
    except FutureTimeout:
        spark.cancel_tag(tag)
        duration = int((time.perf_counter() - t0) * 1000)
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, error=? WHERE id=?",
            ("CANCELED", db.now(), duration, f"timed out after {timeout_s:.0f}s", query_id),
        )
        return {"id": query_id, "status": "TIMED_OUT", "duration_ms": duration,
                "error": f"statement timed out after {timeout_s:.0f}s", "columns": [], "rows": [], "row_count": 0}
    except Exception as exc:  # noqa: BLE001
        duration = int((time.perf_counter() - t0) * 1000)
        message = str(exc)
        cancelled = "cancel" in message.lower() or "interrupt" in message.lower()
        status = "CANCELED" if cancelled else "FAILED"
        db.execute(
            "UPDATE query_history SET status=?, ended_at=?, duration_ms=?, error=? WHERE id=?",
            (status, db.now(), duration, message, query_id),
        )
        return {"id": query_id, "status": status, "duration_ms": duration, "error": message,
                "columns": [], "rows": [], "row_count": 0}


def history(limit: int = 100, status: str | None = None, search: str | None = None) -> list[dict[str, Any]]:
    clauses, params = [], []
    if status and status != "all":
        clauses.append("status = ?")
        params.append(status.upper())
    if search:
        clauses.append("sql LIKE ?")
        params.append(f"%{search}%")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.query(
        f"SELECT * FROM query_history {where} ORDER BY started_at DESC LIMIT ?",
        (*params, limit),
    )
    for row in rows:
        row["referenced_tables"] = db.loads(row.get("referenced_tables"), [])
        row["spark_job_ids"] = db.loads(row.get("spark_job_ids"), [])
    return rows
