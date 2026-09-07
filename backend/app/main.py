"""open-lakehouse workspace API.

A thin gateway in front of the running lakehouse: Unity Catalog for metadata,
Spark Connect for execution, the Spark master/driver UIs for cluster state,
and a local SQLite database for workspace objects the lakehouse itself does
not model (saved queries, dashboards, jobs, alerts, notebooks).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, scheduler
from .config import settings
from .routers import (
    ai, alerts, catalog, compute, dashboards, jobs, lineage, notebooks, pipelines, sql, streaming, workspace,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("lakehouse")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.connect()
    scheduler.start()
    log.info("workspace API ready — spark=%s uc=%s", settings.spark_remote, settings.uc_url)
    yield
    scheduler.stop()


app = FastAPI(
    title="open-lakehouse workspace API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (catalog, sql, compute, jobs, pipelines, dashboards, alerts, notebooks, lineage, workspace, streaming, ai):
    app.include_router(router.router, prefix="/api")


@app.get("/api/config")
async def config() -> dict:
    """Endpoints the UI shows on the compute and settings pages."""
    return {
        "spark_remote": settings.spark_remote,
        "unity_catalog_url": settings.uc_url,
        "spark_master_ui": settings.spark_master_ui,
        "spark_worker_ui": settings.spark_worker_ui,
        "spark_driver_ui": settings.spark_connect_ui,
        "s3_endpoint": settings.s3_endpoint,
        "warehouse_root": settings.warehouse_root,
        "kafka_bootstrap": settings.kafka_bootstrap,
        "max_result_rows": settings.max_result_rows,
    }


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
