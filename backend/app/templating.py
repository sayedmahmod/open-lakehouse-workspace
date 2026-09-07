"""Parameter substitution for job tasks, using `{{ ... }}` placeholders.

Supported references
-------------------
``{{job.id}}`` ``{{job.name}}``
``{{job.run_id}}`` / ``{{run.id}}`` / ``{{run.number}}``
``{{run.trigger}}`` / ``{{job.trigger.type}}``
``{{job.parameters.<name>}}``            job-level parameter
``{{<name>}}``                           shorthand for a job/for-each parameter
``{{job.start_time.iso_date}}``          e.g. 2026-09-07
``{{job.start_time.iso_datetime}}``      e.g. 2026-09-07T04:12:00Z
``{{job.start_time.timestamp_ms}}``
``{{task.key}}`` / ``{{task.name}}``
``{{tasks.<key>.values.<name>}}``        a value another task published
``{{tasks.<key>.result_state}}``         SUCCESS / FAILED / SKIPPED / ...
``{{input}}`` / ``{{input.<field>}}``    the current for-each item
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

_REF = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def build_context(
    *,
    job: dict[str, Any],
    run: dict[str, Any],
    parameters: dict[str, Any],
    task_key: str | None = None,
    task_name: str | None = None,
    task_values: dict[str, dict[str, Any]] | None = None,
    task_states: dict[str, str] | None = None,
    loop_input: Any = None,
    start_time: datetime | None = None,
) -> dict[str, Any]:
    started = start_time or datetime.now(timezone.utc)
    return {
        "job": job,
        "run": run,
        "parameters": parameters or {},
        "task_key": task_key,
        "task_name": task_name or task_key,
        "task_values": task_values or {},
        "task_states": task_states or {},
        "loop_input": loop_input,
        "start_time": started,
    }


def _lookup(ref: str, ctx: dict[str, Any]) -> str | None:
    job = ctx["job"]
    run = ctx["run"]
    params = ctx["parameters"]
    started: datetime = ctx["start_time"]

    simple = {
        "job.id": job.get("id"),
        "job.name": job.get("name"),
        "job.run_id": run.get("id"),
        "run.id": run.get("id"),
        "run.number": run.get("run_number"),
        "run.trigger": run.get("trigger"),
        "job.trigger.type": run.get("trigger"),
        "task.key": ctx.get("task_key"),
        "task.name": ctx.get("task_name"),
        "job.start_time.iso_date": started.date().isoformat(),
        "job.start_time.iso_datetime": started.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "job.start_time.timestamp_ms": int(started.timestamp() * 1000),
        "job.start_time.year": started.year,
        "job.start_time.month": f"{started.month:02d}",
        "job.start_time.day": f"{started.day:02d}",
    }
    if ref in simple and simple[ref] is not None:
        return str(simple[ref])

    if ref == "input":
        return _stringify(ctx.get("loop_input"))
    if ref.startswith("input."):
        return _stringify(_dig(ctx.get("loop_input"), ref[len("input."):]))

    if ref.startswith("job.parameters."):
        name = ref[len("job.parameters."):]
        return _stringify(params.get(name)) if name in params else None

    if ref.startswith("tasks."):
        rest = ref[len("tasks."):]
        key, _, tail = rest.partition(".")
        if tail.startswith("values."):
            value_name = tail[len("values."):]
            bucket = ctx["task_values"].get(key, {})
            return _stringify(bucket[value_name]) if value_name in bucket else None
        if tail in ("result_state", "state"):
            return ctx["task_states"].get(key)
        return None

    # bare shorthand: a job / for-each parameter
    if ref in params:
        return _stringify(params[ref])
    if re.fullmatch(r"[A-Za-z_][\w]*", ref):
        return None
    return None


def _dig(obj: Any, path: str) -> Any:
    for part in path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(part)
        else:
            return None
    return obj


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, default=str)


def render(text: str, ctx: dict[str, Any]) -> str:
    """Replace every resolvable reference; leave unknown ones untouched."""
    if not text or "{{" not in text:
        return text

    def sub(match: "re.Match[str]") -> str:
        ref = match.group(1).strip()
        resolved = _lookup(ref, ctx)
        return resolved if resolved is not None else match.group(0)

    return _REF.sub(sub, text)


def unresolved(text: str, ctx: dict[str, Any]) -> list[str]:
    return [m.group(1).strip() for m in _REF.finditer(text or "") if _lookup(m.group(1).strip(), ctx) is None]


def render_params(params: dict[str, str], ctx: dict[str, Any]) -> dict[str, str]:
    return {k: render(v, ctx) for k, v in (params or {}).items()}
