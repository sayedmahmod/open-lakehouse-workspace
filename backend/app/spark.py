"""Spark Connect gateway.

Holds one long-lived Spark Connect session and runs statements on a thread
pool so the FastAPI event loop never blocks. Each statement gets a Spark job
tag, which is what makes real cancellation possible.
"""
from __future__ import annotations

import base64
import datetime as dt
import decimal
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .config import settings

log = logging.getLogger("lakehouse.spark")

_session_lock = threading.Lock()
_session: Any = None
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="spark")


class SparkUnavailable(RuntimeError):
    """Raised when the Spark Connect server cannot be reached."""


def get_session(force_new: bool = False):
    """Return the shared Spark Connect session, creating it on first use."""
    global _session
    with _session_lock:
        if _session is not None and not force_new:
            return _session
        try:
            from pyspark.sql import SparkSession
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise SparkUnavailable(f"pyspark client not installed: {exc}") from exc
        try:
            if _session is not None and force_new:
                try:
                    _session.stop()
                except Exception:
                    pass
                _session = None
            _session = SparkSession.builder.remote(settings.spark_remote).getOrCreate()
            log.info("Spark Connect session established (%s)", settings.spark_remote)
        except Exception as exc:
            raise SparkUnavailable(str(exc)) from exc
        return _session


def reset_session() -> None:
    global _session
    with _session_lock:
        if _session is not None:
            try:
                _session.stop()
            except Exception:
                pass
        _session = None


def json_safe(value: Any) -> Any:
    """Convert a Spark value into something json.dumps can handle."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(bytes(value)).decode("ascii")
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    as_dict = getattr(value, "asDict", None)
    if callable(as_dict):
        try:
            return {str(k): json_safe(v) for k, v in as_dict().items()}
        except Exception:
            pass
    return str(value)


# Statements that produce a result set worth rendering as a grid.
_SELECTISH = re.compile(r"^\s*(select|with|show|describe|desc|explain|values|table|from)\b", re.I)
_DDL = re.compile(r"^\s*(create|alter|drop|truncate|comment|grant|revoke|use|set|refresh|msck|vacuum|optimize|analyze|repair)\b", re.I)
_DML = re.compile(r"^\s*(insert|update|delete|merge|copy)\b", re.I)


def statement_type(sql: str) -> str:
    stripped = strip_comments(sql).strip()
    if _SELECTISH.match(stripped):
        return "SELECT"
    if _DML.match(stripped):
        return "DML"
    if _DDL.match(stripped):
        return "DDL"
    return "OTHER"


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


_TABLE_REF = re.compile(
    r"\b(?:from|join|into|update|table|merge\s+into|insert\s+overwrite(?:\s+table)?)\s+"
    r"([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*){0,2})",
    re.I,
)


def referenced_tables(sql: str) -> list[str]:
    """Best-effort extraction of table identifiers, used to build lineage."""
    found: list[str] = []
    for match in _TABLE_REF.finditer(strip_comments(sql)):
        name = match.group(1)
        if name.lower() in {"select", "values", "lateral", "unnest", "json"}:
            continue
        if name not in found:
            found.append(name)
    return found


def split_statements(sql: str) -> list[str]:
    """Split a script on semicolons that are not inside quotes or comments."""
    statements: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if quote:
            buf.append(ch)
            if ch == "\\" and nxt:
                buf.append(nxt)
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "-" and nxt == "-":
            while i < n and sql[i] != "\n":
                buf.append(sql[i])
                i += 1
            continue
        if ch == "/" and nxt == "*":
            buf.append(ch)
            buf.append(nxt)
            i += 2
            while i < n and not (sql[i] == "*" and i + 1 < n and sql[i + 1] == "/"):
                buf.append(sql[i])
                i += 1
            continue
        if ch == ";":
            statements.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    if "".join(buf).strip():
        statements.append("".join(buf))
    return [s for s in (st.strip() for st in statements) if s]


def _schema_fields(df: Any) -> list[dict[str, Any]]:
    try:
        return [
            {
                "name": f.name,
                "type": f.dataType.simpleString(),
                "nullable": bool(f.nullable),
            }
            for f in df.schema.fields
        ]
    except Exception:
        return []


def run_sql(sql: str, *, limit: int | None = None, tag: str | None = None) -> dict[str, Any]:
    """Execute one statement and materialise its result.

    Runs on the calling thread — callers dispatch it through `submit`.
    """
    spark = get_session()
    if tag:
        try:
            spark.addTag(tag)
        except Exception:
            pass
    try:
        df = spark.sql(sql)
        kind = statement_type(sql)
        cap = settings.max_result_rows if limit is None else min(limit, settings.max_result_rows)
        columns = _schema_fields(df)
        if not columns:
            return {"columns": [], "rows": [], "row_count": 0, "truncated": False, "statement_type": kind}
        # Pull one extra row so we can tell the UI the grid was truncated.
        collected = df.limit(cap + 1).collect()
        truncated = len(collected) > cap
        rows = [[json_safe(v) for v in row] for row in collected[:cap]]
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "statement_type": kind,
        }
    finally:
        if tag:
            try:
                spark.removeTag(tag)
            except Exception:
                pass


def cancel_tag(tag: str) -> bool:
    try:
        get_session().interruptTag(tag)
        return True
    except Exception as exc:
        log.warning("interruptTag(%s) failed: %s", tag, exc)
        return False


def submit(fn, *args, **kwargs):
    return _pool.submit(fn, *args, **kwargs)


def health() -> dict[str, Any]:
    try:
        spark = get_session()
        version = spark.version
        return {"reachable": True, "version": version, "remote": settings.spark_remote}
    except Exception as exc:
        return {"reachable": False, "error": str(exc), "remote": settings.spark_remote}
