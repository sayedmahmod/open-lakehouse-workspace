"""Workflows: job definitions, triggers, repair, run history and task graphs."""
from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import db, notifications, orchestrator, scheduler

router = APIRouter(prefix="/jobs", tags=["jobs"])


class RetryPolicy(BaseModel):
    max_retries: int = 0
    min_retry_interval_millis: int = 0
    retry_on_timeout: bool = False


class ConditionSpec(BaseModel):
    left: str = ""
    op: str = "=="
    right: str = ""


class ForEachSpec(BaseModel):
    inputs: str = "[]"
    concurrency: int = 1


class DependsOn(BaseModel):
    key: str
    outcome: str = "success"          # success | done | failed | true | false


class TaskIn(BaseModel):
    key: str
    name: str | None = None
    description: str = ""
    type: str = "sql"                 # sql|notebook|saved_query|dashboard|condition|for_each|run_job|pipeline
    sql: str = ""
    notebook_id: str | None = None
    query_id: str | None = None
    dashboard_id: str | None = None
    run_job_id: str | None = None
    pipeline_id: str | None = None
    condition: ConditionSpec | None = None
    for_each: ForEachSpec | None = None
    inner_task: "TaskIn | None" = None
    depends_on: list[DependsOn] = Field(default_factory=list)
    run_if: str = "ALL_SUCCESS"
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    timeout_seconds: int = 0
    parameters: dict[str, str] = Field(default_factory=dict)
    capture_output: bool = False
    disabled: bool = False


TaskIn.model_rebuild()


class JobParameter(BaseModel):
    name: str
    default: str = ""


class NotificationSettings(BaseModel):
    on_start: list[str] = Field(default_factory=list)
    on_success: list[str] = Field(default_factory=list)
    on_failure: list[str] = Field(default_factory=list)
    on_duration_warning: list[str] = Field(default_factory=list)
    min_duration_warning_seconds: int = 0


class JobIn(BaseModel):
    name: str
    description: str = ""
    tasks: list[TaskIn] = Field(default_factory=list)
    schedule: dict[str, Any] | None = None
    paused: bool = True
    tags: list[str] = Field(default_factory=list)
    parameters: list[JobParameter] = Field(default_factory=list)
    max_concurrent_runs: int = 1
    timeout_seconds: int = 0
    queue_enabled: bool = True
    continuous: bool = False
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    health: dict[str, Any] = Field(default_factory=dict)


class JobPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    tasks: list[TaskIn] | None = None
    schedule: dict[str, Any] | None = None
    paused: bool | None = None
    tags: list[str] | None = None
    parameters: list[JobParameter] | None = None
    max_concurrent_runs: int | None = None
    timeout_seconds: int | None = None
    queue_enabled: bool | None = None
    continuous: bool | None = None
    notifications: NotificationSettings | None = None
    health: dict[str, Any] | None = None


class RunRequest(BaseModel):
    parameters: dict[str, str] = Field(default_factory=dict)


class TestWebhook(BaseModel):
    url: str


# --------------------------------------------------------------------- hydration


def _hydrate(job: dict[str, Any]) -> dict[str, Any]:
    job["tasks"] = [orchestrator.normalize_task(t) for t in db.loads(job.get("tasks"), [])]
    job["schedule"] = db.loads(job.get("schedule"), None)
    job["tags"] = db.loads(job.get("tags"), [])
    job["parameters"] = db.loads(job.get("parameters"), [])
    job["notifications"] = db.loads(job.get("notifications"), {})
    job["health"] = db.loads(job.get("health"), {})
    job["paused"] = bool(job.get("paused"))
    job["continuous"] = bool(job.get("continuous"))
    job["queue_enabled"] = bool(job.get("queue_enabled", 1))
    return job


def _hydrate_run(run: dict[str, Any]) -> dict[str, Any]:
    run["task_runs"] = db.loads(run.get("task_runs"), [])
    run["trigger_params"] = db.loads(run.get("trigger_params"), {})
    return run


# --------------------------------------------------------------------- jobs CRUD


@router.get("")
async def list_jobs() -> list[dict[str, Any]]:
    jobs = [_hydrate(j) for j in db.query("SELECT * FROM jobs ORDER BY updated_at DESC")]
    for job in jobs:
        last = db.query_one(
            "SELECT id, status, started_at, duration_ms, run_number FROM job_runs WHERE job_id = ?"
            " ORDER BY run_number DESC LIMIT 1",
            (job["id"],),
        )
        job["last_run"] = last
        recent = db.query(
            "SELECT status FROM job_runs WHERE job_id = ? ORDER BY run_number DESC LIMIT 10", (job["id"],)
        )
        job["recent_statuses"] = [r["status"] for r in reversed(recent)]
        stats = db.query_one(
            "SELECT COUNT(*) AS total, SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS ok"
            " FROM job_runs WHERE job_id = ?",
            (job["id"],),
        ) or {}
        total = int(stats.get("total") or 0)
        job["run_count"] = total
        job["success_rate"] = round(int(stats.get("ok") or 0) / total * 100, 1) if total else None
    return jobs


@router.post("")
async def create_job(body: JobIn) -> dict[str, Any]:
    tasks = [t.model_dump() for t in body.tasks]
    problems = orchestrator.validate(tasks) if tasks else []
    if problems:
        raise HTTPException(status_code=422, detail="; ".join(problems))
    jid = db.new_id()
    ts = db.now()
    next_run = scheduler.compute_next_run(body.schedule) if body.schedule and not body.paused else None
    db.execute(
        "INSERT INTO jobs (id, name, description, tasks, schedule, paused, created_at, updated_at, next_run_at,"
        " tags, parameters, max_concurrent_runs, timeout_seconds, queue_enabled, continuous, notifications, health)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (jid, body.name, body.description, db.dumps(tasks),
         db.dumps(body.schedule) if body.schedule else None, 1 if body.paused else 0, ts, ts, next_run,
         db.dumps(body.tags), db.dumps([p.model_dump() for p in body.parameters]),
         max(1, body.max_concurrent_runs), max(0, body.timeout_seconds), 1 if body.queue_enabled else 0,
         1 if body.continuous else 0, db.dumps(body.notifications.model_dump()), db.dumps(body.health)),
    )
    return await get_job(jid)


@router.get("/{jid}")
async def get_job(jid: str) -> dict[str, Any]:
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (jid,))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _hydrate(job)


@router.patch("/{jid}")
async def update_job(jid: str, body: JobPatch) -> dict[str, Any]:
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (jid,))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if body.tasks is not None:
        problems = orchestrator.validate([t.model_dump() for t in body.tasks])
        if problems:
            raise HTTPException(status_code=422, detail="; ".join(problems))

    fields, params = [], []
    simple: dict[str, Any] = {}
    if body.name is not None:
        simple["name"] = body.name
    if body.description is not None:
        simple["description"] = body.description
    if body.tasks is not None:
        simple["tasks"] = db.dumps([t.model_dump() for t in body.tasks])
    if body.schedule is not None:
        simple["schedule"] = db.dumps(body.schedule)
    if body.tags is not None:
        simple["tags"] = db.dumps(body.tags)
    if body.parameters is not None:
        simple["parameters"] = db.dumps([p.model_dump() for p in body.parameters])
    if body.max_concurrent_runs is not None:
        simple["max_concurrent_runs"] = max(1, body.max_concurrent_runs)
    if body.timeout_seconds is not None:
        simple["timeout_seconds"] = max(0, body.timeout_seconds)
    if body.queue_enabled is not None:
        simple["queue_enabled"] = 1 if body.queue_enabled else 0
    if body.continuous is not None:
        simple["continuous"] = 1 if body.continuous else 0
    if body.notifications is not None:
        simple["notifications"] = db.dumps(body.notifications.model_dump())
    if body.health is not None:
        simple["health"] = db.dumps(body.health)

    for column, value in simple.items():
        fields.append(f"{column} = ?")
        params.append(value)

    if body.paused is not None:
        fields.append("paused = ?")
        params.append(1 if body.paused else 0)
    if body.paused is not None or body.schedule is not None:
        paused = body.paused if body.paused is not None else bool(job.get("paused"))
        schedule = body.schedule if body.schedule is not None else db.loads(job.get("schedule"), None)
        fields.append("next_run_at = ?")
        params.append(None if paused or not schedule else scheduler.compute_next_run(schedule))

    fields.append("updated_at = ?")
    params.append(db.now())
    params.append(jid)
    db.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?", params)
    return await get_job(jid)


@router.delete("/{jid}")
async def delete_job(jid: str) -> dict[str, str]:
    run_ids = [r["id"] for r in db.query("SELECT id FROM job_runs WHERE job_id = ?", (jid,))]
    for rid in run_ids:
        db.execute("DELETE FROM task_values WHERE run_id = ?", (rid,))
    db.execute("DELETE FROM job_runs WHERE job_id = ?", (jid,))
    db.execute("DELETE FROM jobs WHERE id = ?", (jid,))
    return {"status": "deleted"}


@router.post("/{jid}/validate")
async def validate_job(jid: str) -> dict[str, Any]:
    job = await get_job(jid)
    return {"errors": orchestrator.validate(job["tasks"])}


# --------------------------------------------------------------------- triggering


@router.post("/{jid}/run")
async def trigger_run(jid: str, body: RunRequest | None = None) -> dict[str, Any]:
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (jid,))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    params = body.parameters if body else {}
    run = orchestrator.start_run(jid, "manual", params, wait=False)
    if run is None:
        raise HTTPException(status_code=409, detail="This job is at its concurrent-run limit and queueing is off.")
    return _hydrate_run(run)


@router.post("/runs/{run_id}/repair")
async def repair_run(run_id: str, body: RunRequest | None = None) -> dict[str, Any]:
    run = orchestrator.repair_run(run_id, body.parameters if body else None)
    if run is None:
        raise HTTPException(status_code=409, detail="This run has no failed tasks to repair.")
    return _hydrate_run(run)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict[str, str]:
    if not orchestrator.cancel_run(run_id):
        raise HTTPException(status_code=409, detail="Run is not cancellable.")
    return {"status": "canceling"}


# --------------------------------------------------------------------- run history


@router.get("/{jid}/runs")
async def job_runs(jid: str, limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return [
        _hydrate_run(r)
        for r in db.query(
            "SELECT * FROM job_runs WHERE job_id = ? ORDER BY run_number DESC LIMIT ?", (jid, limit)
        )
    ]


@router.get("/{jid}/matrix")
async def run_matrix(jid: str, limit: int = Query(20, ge=1, le=60)) -> dict[str, Any]:
    """Task × run grid, the way the Workflows 'Matrix' view lays runs out."""
    job = await get_job(jid)
    task_order = [{"key": t["key"], "name": t.get("name") or t["key"], "type": t["type"]} for t in job["tasks"]]
    runs = [
        _hydrate_run(r)
        for r in db.query(
            "SELECT * FROM job_runs WHERE job_id = ? ORDER BY run_number DESC LIMIT ?", (jid, limit)
        )
    ]
    grid = []
    for run in runs:
        cells = {tr["key"]: {"status": tr["status"], "duration_ms": tr.get("duration_ms")} for tr in run["task_runs"]}
        grid.append({
            "id": run["id"], "run_number": run["run_number"], "status": run["status"],
            "trigger": run["trigger"], "started_at": run["started_at"], "duration_ms": run.get("duration_ms"),
            "repair_count": run.get("repair_count", 0), "cells": cells,
        })
    return {"tasks": task_order, "runs": grid}


@router.get("/runs/all")
async def all_runs(limit: int = Query(100, ge=1, le=500), status: str | None = None,
                   job_id: str | None = None) -> list[dict[str, Any]]:
    clauses, params = [], []
    if status and status != "all":
        clauses.append("r.status = ?")
        params.append(status.upper())
    if job_id:
        clauses.append("r.job_id = ?")
        params.append(job_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.query(
        f"SELECT r.*, j.name AS job_name FROM job_runs r JOIN jobs j ON j.id = r.job_id {where}"
        " ORDER BY r.started_at DESC LIMIT ?",
        (*params, limit),
    )
    return [_hydrate_run(r) for r in rows]


@router.get("/runs/detail/{run_id}")
async def run_detail(run_id: str) -> dict[str, Any]:
    run = db.query_one(
        "SELECT r.*, j.name AS job_name FROM job_runs r JOIN jobs j ON j.id = r.job_id WHERE r.id = ?",
        (run_id,),
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _hydrate_run(run)
    values = db.query("SELECT task_key, name, value, set_at FROM task_values WHERE run_id = ?", (run_id,))
    run["task_values"] = [
        {"task_key": v["task_key"], "name": v["name"], "value": db.loads(v["value"], v["value"]), "set_at": v["set_at"]}
        for v in values
    ]
    return run


# --------------------------------------------------------------------- notifications


@router.get("/{jid}/notifications/log")
async def notification_log(jid: str, limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    return notifications.recent(limit, subject_id=jid)


@router.post("/{jid}/notifications/test")
async def notification_test(jid: str, body: TestWebhook) -> dict[str, str]:
    job = db.query_one("SELECT * FROM jobs WHERE id = ?", (jid,))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    payload = {"subject_kind": "job", "subject_id": jid, "job_id": jid, "job_name": job["name"],
               "state": "TEST", "message": "Test webhook from the open-lakehouse workspace"}
    threading.Thread(
        target=notifications.dispatch, args=("test", [body.url], payload), daemon=True
    ).start()
    return {"status": "sent"}
