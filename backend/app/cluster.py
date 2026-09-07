"""Spark standalone cluster + Spark Connect driver introspection.

Reads the JSON endpoints the Spark master, worker and driver UIs already
expose, and reshapes them into the compute/job views the frontend renders.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("lakehouse.cluster")


async def _get_json(url: str, timeout: float = 8.0) -> Any:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers={"Accept": "application/json"})
        resp.raise_for_status()
        return resp.json()


async def master_state() -> dict[str, Any]:
    """Cluster-level state: workers, cores, memory, applications."""
    try:
        data = await _get_json(f"{settings.spark_master_ui.rstrip('/')}/json/")
    except Exception as exc:
        return {"reachable": False, "error": str(exc), "url": settings.spark_master_ui}

    workers = data.get("workers") or []
    return {
        "reachable": True,
        "url": settings.spark_master_ui,
        "master_url": data.get("url"),
        "status": data.get("status"),
        "cores_total": data.get("cores", 0),
        "cores_used": data.get("coresused", 0),
        "memory_total_mb": data.get("memory", 0),
        "memory_used_mb": data.get("memoryused", 0),
        "alive_workers": data.get("aliveworkers", 0),
        "workers": [
            {
                "id": w.get("id"),
                "host": w.get("host"),
                "port": w.get("port"),
                "webui": w.get("webuiaddress"),
                "state": w.get("state"),
                "cores": w.get("cores", 0),
                "cores_used": w.get("coresused", 0),
                "cores_free": w.get("coresfree", 0),
                "memory_mb": w.get("memory", 0),
                "memory_used_mb": w.get("memoryused", 0),
                "memory_free_mb": w.get("memoryfree", 0),
                "last_heartbeat": w.get("lastheartbeat"),
            }
            for w in workers
        ],
        "active_apps": [_app(a) for a in (data.get("activeapps") or [])],
        "completed_apps": [_app(a) for a in (data.get("completedapps") or [])],
    }


def _app(a: dict) -> dict:
    return {
        "id": a.get("id"),
        "name": a.get("name"),
        "state": a.get("state"),
        "cores": a.get("cores", 0),
        "memory_per_executor_mb": a.get("memoryperexecutor" if "memoryperexecutor" in a else "memoryperslave", 0),
        "submitted_at": a.get("starttime"),
        "duration_ms": a.get("duration"),
        "user": a.get("user"),
    }


async def _driver_api(path: str) -> Any:
    """Call the Spark driver's REST API (the Connect server's application UI)."""
    base = settings.spark_connect_ui.rstrip("/")
    return await _get_json(f"{base}{path}")


async def driver_applications() -> list[dict]:
    try:
        return await _driver_api("/api/v1/applications") or []
    except Exception:
        return []


async def spark_jobs(limit: int = 60) -> list[dict]:
    """Recent Spark jobs from the Connect driver, newest first."""
    apps = await driver_applications()
    if not apps:
        return []
    app_id = apps[0].get("id")
    try:
        jobs = await _driver_api(f"/api/v1/applications/{app_id}/jobs") or []
    except Exception:
        return []
    jobs = sorted(jobs, key=lambda j: j.get("jobId", 0), reverse=True)[:limit]
    return [
        {
            "job_id": j.get("jobId"),
            "name": j.get("name"),
            "status": j.get("status"),
            "submitted_at": j.get("submissionTime"),
            "completed_at": j.get("completionTime"),
            "num_tasks": j.get("numTasks", 0),
            "completed_tasks": j.get("numCompletedTasks", 0),
            "failed_tasks": j.get("numFailedTasks", 0),
            "active_tasks": j.get("numActiveTasks", 0),
            "stage_ids": j.get("stageIds") or [],
            "app_id": app_id,
        }
        for j in jobs
    ]


async def executors() -> list[dict]:
    apps = await driver_applications()
    if not apps:
        return []
    app_id = apps[0].get("id")
    try:
        rows = await _driver_api(f"/api/v1/applications/{app_id}/executors") or []
    except Exception:
        return []
    return [
        {
            "id": e.get("id"),
            "host_port": e.get("hostPort"),
            "is_active": e.get("isActive"),
            "rdd_blocks": e.get("rddBlocks", 0),
            "memory_used": e.get("memoryUsed", 0),
            "disk_used": e.get("diskUsed", 0),
            "total_cores": e.get("totalCores", 0),
            "active_tasks": e.get("activeTasks", 0),
            "failed_tasks": e.get("failedTasks", 0),
            "completed_tasks": e.get("completedTasks", 0),
            "total_duration_ms": e.get("totalDuration", 0),
            "total_input_bytes": e.get("totalInputBytes", 0),
            "total_shuffle_read": e.get("totalShuffleRead", 0),
            "total_shuffle_write": e.get("totalShuffleWrite", 0),
            "max_memory": e.get("maxMemory", 0),
            "add_time": e.get("addTime"),
        }
        for e in rows
    ]


async def worker_state() -> dict[str, Any]:
    try:
        data = await _get_json(f"{settings.spark_worker_ui.rstrip('/')}/json/")
        return {"reachable": True, **data}
    except Exception as exc:
        return {"reachable": False, "error": str(exc)}
