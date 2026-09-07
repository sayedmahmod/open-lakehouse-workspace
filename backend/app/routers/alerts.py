"""Alerts: a scheduled query plus a threshold condition on one of its columns."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import db, scheduler

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertIn(BaseModel):
    name: str
    sql: str
    column_name: str = ""
    operator: str = ">"
    threshold: str = "0"
    schedule: dict[str, Any] | None = None
    paused: bool = True


def _hydrate(row: dict[str, Any]) -> dict[str, Any]:
    row["schedule"] = db.loads(row.get("schedule"), None)
    row["paused"] = bool(row.get("paused"))
    return row


@router.get("")
async def list_alerts() -> list[dict[str, Any]]:
    return [_hydrate(r) for r in db.query("SELECT * FROM alerts ORDER BY updated_at DESC")]


@router.post("")
async def create_alert(body: AlertIn) -> dict[str, Any]:
    aid = db.new_id()
    ts = db.now()
    db.execute(
        "INSERT INTO alerts (id, name, sql, column_name, operator, threshold, schedule, paused, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        (aid, body.name, body.sql, body.column_name, body.operator, body.threshold,
         db.dumps(body.schedule) if body.schedule else None, 1 if body.paused else 0, ts, ts),
    )
    return await get_alert(aid)


@router.get("/{aid}")
async def get_alert(aid: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM alerts WHERE id = ?", (aid,))
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    return _hydrate(row)


class AlertPatch(BaseModel):
    name: str | None = None
    sql: str | None = None
    column_name: str | None = None
    operator: str | None = None
    threshold: str | None = None
    schedule: dict[str, Any] | None = None
    paused: bool | None = None


@router.patch("/{aid}")
async def update_alert(aid: str, body: AlertPatch) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM alerts WHERE id = ?", (aid,)):
        raise HTTPException(status_code=404, detail="Alert not found")
    fields, params = [], []
    for column, value in (
        ("name", body.name), ("sql", body.sql), ("column_name", body.column_name),
        ("operator", body.operator), ("threshold", body.threshold),
    ):
        if value is not None:
            fields.append(f"{column} = ?"); params.append(value)
    if body.schedule is not None:
        fields.append("schedule = ?"); params.append(db.dumps(body.schedule))
    if body.paused is not None:
        fields.append("paused = ?"); params.append(1 if body.paused else 0)
    fields.append("updated_at = ?"); params.append(db.now())
    params.append(aid)
    db.execute(f"UPDATE alerts SET {', '.join(fields)} WHERE id = ?", params)
    return await get_alert(aid)


@router.delete("/{aid}")
async def delete_alert(aid: str) -> dict[str, str]:
    db.execute("DELETE FROM alert_events WHERE alert_id = ?", (aid,))
    db.execute("DELETE FROM alerts WHERE id = ?", (aid,))
    return {"status": "deleted"}


@router.post("/{aid}/evaluate")
async def evaluate(aid: str) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM alerts WHERE id = ?", (aid,)):
        raise HTTPException(status_code=404, detail="Alert not found")
    result = await asyncio.to_thread(scheduler.evaluate_alert, aid)
    return result or {}


@router.get("/{aid}/events")
async def events(aid: str, limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return db.query(
        "SELECT * FROM alert_events WHERE alert_id = ? ORDER BY checked_at DESC LIMIT ?", (aid, limit)
    )
