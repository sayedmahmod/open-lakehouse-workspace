"""AI/BI-style dashboards: datasets (SQL) plus widgets that visualise them."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, queries

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


class DatasetIn(BaseModel):
    key: str
    name: str
    sql: str


class WidgetIn(BaseModel):
    id: str
    type: str = "table"          # table | bar | line | area | pie | counter | text
    title: str = ""
    dataset_key: str | None = None
    x: str | None = None
    y: list[str] = []
    group_by: str | None = None
    text: str = ""
    layout: dict[str, Any] = {}
    options: dict[str, Any] = {}


class DashboardIn(BaseModel):
    name: str
    description: str = ""
    datasets: list[DatasetIn] = []
    widgets: list[WidgetIn] = []
    folder_id: str | None = None


def _hydrate(row: dict[str, Any]) -> dict[str, Any]:
    row["widgets"] = db.loads(row.get("widgets"), [])
    row["datasets"] = db.loads(row.get("datasets"), [])
    row["favorite"] = bool(row.get("favorite"))
    return row


@router.get("")
async def list_dashboards() -> list[dict[str, Any]]:
    return [_hydrate(r) for r in db.query("SELECT * FROM dashboards ORDER BY updated_at DESC")]


@router.post("")
async def create_dashboard(body: DashboardIn) -> dict[str, Any]:
    did = db.new_id()
    ts = db.now()
    db.execute(
        "INSERT INTO dashboards (id, name, description, folder_id, widgets, datasets, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (did, body.name, body.description, body.folder_id,
         db.dumps([w.model_dump() for w in body.widgets]),
         db.dumps([d.model_dump() for d in body.datasets]), ts, ts),
    )
    return await get_dashboard(did)


@router.get("/{did}")
async def get_dashboard(did: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM dashboards WHERE id = ?", (did,))
    if not row:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return _hydrate(row)


class DashboardPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    datasets: list[DatasetIn] | None = None
    widgets: list[WidgetIn] | None = None
    favorite: bool | None = None


@router.patch("/{did}")
async def update_dashboard(did: str, body: DashboardPatch) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM dashboards WHERE id = ?", (did,)):
        raise HTTPException(status_code=404, detail="Dashboard not found")
    fields, params = [], []
    if body.name is not None:
        fields.append("name = ?"); params.append(body.name)
    if body.description is not None:
        fields.append("description = ?"); params.append(body.description)
    if body.datasets is not None:
        fields.append("datasets = ?"); params.append(db.dumps([d.model_dump() for d in body.datasets]))
    if body.widgets is not None:
        fields.append("widgets = ?"); params.append(db.dumps([w.model_dump() for w in body.widgets]))
    if body.favorite is not None:
        fields.append("favorite = ?"); params.append(1 if body.favorite else 0)
    fields.append("updated_at = ?"); params.append(db.now())
    params.append(did)
    db.execute(f"UPDATE dashboards SET {', '.join(fields)} WHERE id = ?", params)
    return await get_dashboard(did)


@router.delete("/{did}")
async def delete_dashboard(did: str) -> dict[str, str]:
    db.execute("DELETE FROM dashboards WHERE id = ?", (did,))
    return {"status": "deleted"}


@router.post("/{did}/refresh")
async def refresh(did: str) -> dict[str, Any]:
    """Execute every dataset and return the data each widget renders from."""
    dashboard = await get_dashboard(did)
    datasets = dashboard.get("datasets") or []

    def run_all() -> dict[str, Any]:
        out: dict[str, Any] = {}
        for dataset in datasets:
            outcome = queries.run_blocking(dataset["sql"], source="dashboard", source_id=did)
            out[dataset["key"]] = {
                "status": outcome["status"],
                "columns": outcome.get("columns", []),
                "rows": outcome.get("rows", []),
                "row_count": outcome.get("row_count", 0),
                "error": outcome.get("error"),
                "duration_ms": outcome.get("duration_ms"),
            }
        return out

    return {"refreshed_at": db.now(), "data": await asyncio.to_thread(run_all)}
