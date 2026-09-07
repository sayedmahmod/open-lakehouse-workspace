"""SQLite-backed workspace state.

Everything the lakehouse itself cannot store — saved queries, query history,
notebooks, dashboards, jobs and their runs, alerts — lives here. Unity Catalog
and Spark remain the source of truth for data; this is workspace metadata only.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import settings

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS saved_queries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sql TEXT NOT NULL,
    folder_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS query_history (
    id TEXT PRIMARY KEY,
    sql TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    row_count INTEGER,
    error TEXT,
    source TEXT NOT NULL DEFAULT 'editor',
    source_id TEXT,
    statement_type TEXT,
    referenced_tables TEXT NOT NULL DEFAULT '[]',
    spark_job_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_history_started ON query_history(started_at DESC);

CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_id TEXT,
    cells TEXT NOT NULL DEFAULT '[]',
    default_language TEXT NOT NULL DEFAULT 'sql',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    folder_id TEXT,
    widgets TEXT NOT NULL DEFAULT '[]',
    datasets TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tasks TEXT NOT NULL DEFAULT '[]',
    schedule TEXT,
    paused INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    parameters TEXT NOT NULL DEFAULT '[]',
    max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
    timeout_seconds INTEGER NOT NULL DEFAULT 0,
    queue_enabled INTEGER NOT NULL DEFAULT 1,
    continuous INTEGER NOT NULL DEFAULT 0,
    notifications TEXT NOT NULL DEFAULT '{}',
    health TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    run_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    task_runs TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    trigger_params TEXT NOT NULL DEFAULT '{}',
    repair_count INTEGER NOT NULL DEFAULT 0,
    queued_at TEXT,
    end_state_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON job_runs(job_id, run_number DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON job_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS task_values (
    run_id TEXT NOT NULL,
    task_key TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    set_at TEXT NOT NULL,
    PRIMARY KEY (run_id, task_key, name)
);

CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_catalog TEXT NOT NULL DEFAULT '',
    target_schema TEXT NOT NULL DEFAULT '',
    datasets TEXT NOT NULL DEFAULT '[]',
    configuration TEXT NOT NULL DEFAULT '{}',
    development INTEGER NOT NULL DEFAULT 1,
    continuous INTEGER NOT NULL DEFAULT 0,
    schedule TEXT,
    paused INTEGER NOT NULL DEFAULT 1,
    notifications TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_update_at TEXT,
    next_run_at TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_updates (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL,
    update_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    cause TEXT NOT NULL DEFAULT 'manual',
    full_refresh INTEGER NOT NULL DEFAULT 0,
    refresh_selection TEXT NOT NULL DEFAULT '[]',
    development INTEGER NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    datasets TEXT NOT NULL DEFAULT '[]',
    events TEXT NOT NULL DEFAULT '[]',
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_updates ON pipeline_updates(pipeline_id, update_number DESC);

CREATE TABLE IF NOT EXISTS notification_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    event TEXT NOT NULL,
    subject_kind TEXT NOT NULL DEFAULT '',
    subject_id TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_notification_log ON notification_log(created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sql TEXT NOT NULL,
    column_name TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '>',
    threshold TEXT NOT NULL DEFAULT '0',
    schedule TEXT,
    paused INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at TEXT,
    last_triggered_at TEXT,
    last_value TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_events (
    id TEXT PRIMARY KEY,
    alert_id TEXT NOT NULL,
    state TEXT NOT NULL,
    value TEXT,
    checked_at TEXT NOT NULL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_events ON alert_events(alert_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS table_comments (
    full_name TEXT PRIMARY KEY,
    comment TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recents (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    visited_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recents ON recents(visited_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    surface TEXT NOT NULL DEFAULT '',
    ok INTEGER NOT NULL DEFAULT 1,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_usage ON ai_usage(created_at DESC);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    return uuid.uuid4().hex


def connect() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            os.makedirs(os.path.dirname(settings.state_db), exist_ok=True)
            _conn = sqlite3.connect(settings.state_db, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA foreign_keys=ON")
            _conn.executescript(SCHEMA)
            _migrate(_conn)
            _conn.commit()
        return _conn


# Columns added after the first release; ALTER TABLE ADD COLUMN is a no-op the
# second time round, so failures on "duplicate column" are swallowed.
_MIGRATIONS = [
    "ALTER TABLE jobs ADD COLUMN parameters TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE jobs ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE jobs ADD COLUMN timeout_seconds INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN queue_enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE jobs ADD COLUMN continuous INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN notifications TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE jobs ADD COLUMN health TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE job_runs ADD COLUMN trigger_params TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE job_runs ADD COLUMN repair_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE job_runs ADD COLUMN queued_at TEXT",
    "ALTER TABLE job_runs ADD COLUMN end_state_message TEXT",
]


def _migrate(conn: sqlite3.Connection) -> None:
    for statement in _MIGRATIONS:
        try:
            conn.execute(statement)
        except sqlite3.OperationalError as exc:
            if "duplicate column" not in str(exc).lower():
                raise


def query(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    with _lock:
        cur = connect().execute(sql, tuple(params))
        return [dict(r) for r in cur.fetchall()]


def query_one(sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with _lock:
        conn = connect()
        conn.execute(sql, tuple(params))
        conn.commit()


def loads(value: Any, fallback: Any) -> Any:
    """Parse a JSON column, tolerating nulls and corrupt values."""
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def dumps(value: Any) -> str:
    return json.dumps(value, default=str)
