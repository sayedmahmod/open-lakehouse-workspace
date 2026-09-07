"""Outbound webhook notifications for job and pipeline events.

Comparable products fan these out to email, Slack and generic webhooks. This stack has
no mail transport, so only webhooks are delivered — every attempt (success or
failure) is written to ``notification_log`` and surfaced in the UI.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

import httpx

from . import db

log = logging.getLogger("lakehouse.notify")

# Event names, aligned with the job/pipeline notification settings blocks.
JOB_START = "on_start"
JOB_SUCCESS = "on_success"
JOB_FAILURE = "on_failure"
JOB_DURATION_WARNING = "on_duration_warning"
PIPELINE_START = "on_update_start"
PIPELINE_SUCCESS = "on_update_success"
PIPELINE_FAILURE = "on_update_failure"


def _deliver(url: str, payload: dict[str, Any]) -> None:
    entry_id = db.new_id()
    body = json.dumps(payload, default=str)
    status = "SENT"
    detail: str | None = None
    try:
        resp = httpx.post(url, content=body, headers={"Content-Type": "application/json"}, timeout=10.0)
        if resp.status_code >= 400:
            status = "FAILED"
            detail = f"HTTP {resp.status_code}: {resp.text[:400]}"
        else:
            detail = f"HTTP {resp.status_code}"
    except Exception as exc:  # noqa: BLE001 - the delivery must never crash a run
        status = "FAILED"
        detail = str(exc)[:400]
    db.execute(
        "INSERT INTO notification_log (id, created_at, event, subject_kind, subject_id, url, status, detail, payload)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (
            entry_id, db.now(), payload.get("event", ""), payload.get("subject_kind", ""),
            payload.get("subject_id", ""), url, status, detail, body,
        ),
    )
    if status == "FAILED":
        log.warning("webhook %s failed: %s", url, detail)


def dispatch(event: str, urls: list[str], payload: dict[str, Any]) -> None:
    """Fire a webhook to every configured URL on a background thread."""
    clean = [u.strip() for u in (urls or []) if u and u.strip()]
    if not clean:
        return
    full = {"event": event, **payload}
    for url in clean:
        threading.Thread(target=_deliver, args=(url, full), daemon=True, name="webhook").start()


def recent(limit: int = 100, subject_id: str | None = None) -> list[dict[str, Any]]:
    if subject_id:
        rows = db.query(
            "SELECT * FROM notification_log WHERE subject_id = ? ORDER BY created_at DESC LIMIT ?",
            (subject_id, limit),
        )
    else:
        rows = db.query("SELECT * FROM notification_log ORDER BY created_at DESC LIMIT ?", (limit,))
    for row in rows:
        row["payload"] = db.loads(row.get("payload"), {})
    return rows
