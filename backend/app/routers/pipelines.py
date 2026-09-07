"""Declarative pipelines: dataset definitions, updates, graph and data quality."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db, pipelines, queries, scheduler

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


class Expectation(BaseModel):
    name: str = ""
    condition: str
    action: str = "warn"             # warn | drop | fail


class DatasetIn(BaseModel):
    name: str
    type: str = "materialized_view"  # materialized_view | streaming_table | view
    comment: str = ""
    sql: str = ""
    partition_cols: list[str] = Field(default_factory=list)
    incremental_key: str = ""
    expectations: list[Expectation] = Field(default_factory=list)


class NotificationSettings(BaseModel):
    on_update_success: list[str] = Field(default_factory=list)
    on_update_failure: list[str] = Field(default_factory=list)


class PipelineIn(BaseModel):
    name: str
    description: str = ""
    target_catalog: str = ""
    target_schema: str = ""
    datasets: list[DatasetIn] = Field(default_factory=list)
    configuration: dict[str, str] = Field(default_factory=dict)
    development: bool = True
    continuous: bool = False
    schedule: dict[str, Any] | None = None
    paused: bool = True
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    tags: list[str] = Field(default_factory=list)


class PipelinePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    target_catalog: str | None = None
    target_schema: str | None = None
    datasets: list[DatasetIn] | None = None
    configuration: dict[str, str] | None = None
    development: bool | None = None
    continuous: bool | None = None
    schedule: dict[str, Any] | None = None
    paused: bool | None = None
    notifications: NotificationSettings | None = None
    tags: list[str] | None = None


class StartRequest(BaseModel):
    full_refresh: bool = False
    refresh_selection: list[str] = Field(default_factory=list)


def _hydrate(row: dict[str, Any]) -> dict[str, Any]:
    row["datasets"] = [pipelines.normalize_dataset(d) for d in db.loads(row.get("datasets"), [])]
    row["configuration"] = db.loads(row.get("configuration"), {})
    row["notifications"] = db.loads(row.get("notifications"), {})
    row["schedule"] = db.loads(row.get("schedule"), None)
    row["tags"] = db.loads(row.get("tags"), [])
    row["development"] = bool(row.get("development", 1))
    row["continuous"] = bool(row.get("continuous"))
    row["paused"] = bool(row.get("paused"))
    return row


def _hydrate_update(row: dict[str, Any]) -> dict[str, Any]:
    row["datasets"] = db.loads(row.get("datasets"), [])
    row["events"] = db.loads(row.get("events"), [])
    row["refresh_selection"] = db.loads(row.get("refresh_selection"), [])
    row["full_refresh"] = bool(row.get("full_refresh"))
    row["development"] = bool(row.get("development", 1))
    return row


@router.get("")
async def list_pipelines() -> list[dict[str, Any]]:
    rows = [_hydrate(r) for r in db.query("SELECT * FROM pipelines ORDER BY updated_at DESC")]
    for row in rows:
        last = db.query_one(
            "SELECT id, status, started_at, duration_ms, update_number FROM pipeline_updates"
            " WHERE pipeline_id = ? ORDER BY update_number DESC LIMIT 1",
            (row["id"],),
        )
        row["last_update"] = last
        recent = db.query(
            "SELECT status FROM pipeline_updates WHERE pipeline_id = ? ORDER BY update_number DESC LIMIT 10",
            (row["id"],),
        )
        row["recent_statuses"] = [r["status"] for r in reversed(recent)]
        row["update_count"] = int(
            (db.query_one("SELECT COUNT(*) AS n FROM pipeline_updates WHERE pipeline_id = ?", (row["id"],)) or {}).get("n") or 0
        )
    return rows


@router.post("")
async def create_pipeline(body: PipelineIn) -> dict[str, Any]:
    pid = db.new_id()
    ts = db.now()
    next_run = scheduler.compute_next_run(body.schedule) if body.schedule and not body.paused else None
    db.execute(
        "INSERT INTO pipelines (id, name, description, target_catalog, target_schema, datasets, configuration,"
        " development, continuous, schedule, paused, notifications, tags, created_at, updated_at, next_run_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, body.name, body.description, body.target_catalog, body.target_schema,
         db.dumps([d.model_dump() for d in body.datasets]), db.dumps(body.configuration),
         1 if body.development else 0, 1 if body.continuous else 0,
         db.dumps(body.schedule) if body.schedule else None, 1 if body.paused else 0,
         db.dumps(body.notifications.model_dump()), db.dumps(body.tags), ts, ts, next_run),
    )
    return await get_pipeline(pid)


@router.get("/{pid}")
async def get_pipeline(pid: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pid,))
    if not row:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return _hydrate(row)


@router.patch("/{pid}")
async def update_pipeline(pid: str, body: PipelinePatch) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pid,))
    if not row:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    fields, params = [], []
    mapping: dict[str, Any] = {}
    if body.name is not None:
        mapping["name"] = body.name
    if body.description is not None:
        mapping["description"] = body.description
    if body.target_catalog is not None:
        mapping["target_catalog"] = body.target_catalog
    if body.target_schema is not None:
        mapping["target_schema"] = body.target_schema
    if body.datasets is not None:
        mapping["datasets"] = db.dumps([d.model_dump() for d in body.datasets])
    if body.configuration is not None:
        mapping["configuration"] = db.dumps(body.configuration)
    if body.development is not None:
        mapping["development"] = 1 if body.development else 0
    if body.continuous is not None:
        mapping["continuous"] = 1 if body.continuous else 0
    if body.schedule is not None:
        mapping["schedule"] = db.dumps(body.schedule)
    if body.notifications is not None:
        mapping["notifications"] = db.dumps(body.notifications.model_dump())
    if body.tags is not None:
        mapping["tags"] = db.dumps(body.tags)
    for column, value in mapping.items():
        fields.append(f"{column} = ?")
        params.append(value)
    if body.paused is not None:
        fields.append("paused = ?")
        params.append(1 if body.paused else 0)
    if body.paused is not None or body.schedule is not None:
        paused = body.paused if body.paused is not None else bool(row.get("paused"))
        schedule = body.schedule if body.schedule is not None else db.loads(row.get("schedule"), None)
        fields.append("next_run_at = ?")
        params.append(None if paused or not schedule else scheduler.compute_next_run(schedule))
    fields.append("updated_at = ?")
    params.append(db.now())
    params.append(pid)
    db.execute(f"UPDATE pipelines SET {', '.join(fields)} WHERE id = ?", params)
    return await get_pipeline(pid)


@router.delete("/{pid}")
async def delete_pipeline(pid: str) -> dict[str, str]:
    db.execute("DELETE FROM pipeline_updates WHERE pipeline_id = ?", (pid,))
    db.execute("DELETE FROM pipelines WHERE id = ?", (pid,))
    return {"status": "deleted"}


@router.post("/{pid}/validate")
async def validate_pipeline(pid: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pid,))
    if not row:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return {"errors": pipelines.validate(row)}


@router.post("/{pid}/start")
async def start_pipeline(pid: str, body: StartRequest | None = None) -> dict[str, Any]:
    body = body or StartRequest()
    update = pipelines.start_update(
        pid, cause="manual", full_refresh=body.full_refresh,
        refresh_selection=body.refresh_selection, wait=False,
    )
    if update is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return _hydrate_update(update)


@router.post("/updates/{update_id}/stop")
async def stop_update(update_id: str) -> dict[str, str]:
    if not pipelines.stop_update(update_id):
        raise HTTPException(status_code=409, detail="Update is not running.")
    return {"status": "stopping"}


@router.get("/{pid}/updates")
async def pipeline_updates(pid: str, limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return [
        _hydrate_update(r)
        for r in db.query(
            "SELECT * FROM pipeline_updates WHERE pipeline_id = ? ORDER BY update_number DESC LIMIT ?",
            (pid, limit),
        )
    ]


@router.get("/updates/detail/{update_id}")
async def update_detail(update_id: str) -> dict[str, Any]:
    row = db.query_one(
        "SELECT u.*, p.name AS pipeline_name FROM pipeline_updates u JOIN pipelines p ON p.id = u.pipeline_id"
        " WHERE u.id = ?",
        (update_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Update not found")
    return _hydrate_update(row)


@router.get("/{pid}/graph")
async def pipeline_graph(pid: str) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM pipelines WHERE id = ?", (pid,)):
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipelines.graph(pid)


@router.get("/{pid}/datasets/{name}/preview")
async def dataset_preview(pid: str, name: str, limit: int = Query(100, ge=1, le=1000)) -> dict[str, Any]:
    pipeline = db.query_one("SELECT * FROM pipelines WHERE id = ?", (pid,))
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline["target_catalog"] and pipeline["target_schema"]:
        target = f"{pipeline['target_catalog']}.{pipeline['target_schema']}.{name}"
    else:
        target = name
    return queries.run_blocking(f"SELECT * FROM {target}", source="pipeline", source_id=pid, limit=limit)
