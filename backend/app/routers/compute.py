"""Compute: the Spark cluster, its workers, executors and Spark jobs."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from .. import cluster, spark, uc
from ..config import settings

router = APIRouter(prefix="/compute", tags=["compute"])


@router.get("/cluster")
async def cluster_overview() -> dict[str, Any]:
    master, worker, connect = await asyncio.gather(
        cluster.master_state(),
        cluster.worker_state(),
        asyncio.to_thread(spark.health),
    )
    return {
        "master": master,
        "worker": worker,
        "connect": connect,
        "links": {
            "master_ui": settings.spark_master_ui,
            "worker_ui": settings.spark_worker_ui,
            "driver_ui": settings.spark_connect_ui,
        },
    }


@router.get("/executors")
async def executors() -> list[dict[str, Any]]:
    return await cluster.executors()


@router.get("/spark-jobs")
async def spark_jobs(limit: int = 60) -> list[dict[str, Any]]:
    return await cluster.spark_jobs(limit)


@router.post("/connect/restart-session")
async def restart_session() -> dict[str, Any]:
    """Drop and rebuild the Spark Connect session — the 'Restart' button."""
    await asyncio.to_thread(spark.reset_session)
    return await asyncio.to_thread(spark.health)


@router.get("/health")
async def health() -> dict[str, Any]:
    spark_health, uc_health, master = await asyncio.gather(
        asyncio.to_thread(spark.health),
        uc.health(),
        cluster.master_state(),
    )
    services = [
        {
            "name": "Spark Connect",
            "kind": "compute",
            "healthy": spark_health.get("reachable", False),
            "detail": spark_health.get("version") or spark_health.get("error"),
            "endpoint": settings.spark_remote,
        },
        {
            "name": "Spark Master",
            "kind": "compute",
            "healthy": master.get("reachable", False),
            "detail": f"{master.get('alive_workers', 0)} worker(s)" if master.get("reachable") else master.get("error"),
            "endpoint": settings.spark_master_ui,
        },
        {
            "name": "Unity Catalog",
            "kind": "catalog",
            "healthy": uc_health.get("reachable", False),
            "detail": f"{uc_health.get('catalog_count', 0)} catalog(s)" if uc_health.get("reachable") else uc_health.get("error"),
            "endpoint": settings.uc_url,
        },
    ]
    services.append(await _probe("Object storage (S3)", "storage", settings.s3_endpoint))
    return {"services": services, "healthy": all(s["healthy"] for s in services)}


async def _probe(name: str, kind: str, url: str) -> dict[str, Any]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
        return {"name": name, "kind": kind, "healthy": resp.status_code < 500, "detail": f"HTTP {resp.status_code}", "endpoint": url}
    except Exception as exc:  # noqa: BLE001
        return {"name": name, "kind": kind, "healthy": False, "detail": str(exc), "endpoint": url}
