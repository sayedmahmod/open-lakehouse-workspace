"""Kafka topic overview for the streaming/data-ingestion views."""
from __future__ import annotations

import asyncio
import socket
from typing import Any

from fastapi import APIRouter

from ..config import settings

router = APIRouter(prefix="/streaming", tags=["streaming"])


def _kafka_reachable() -> bool:
    host, _, port = settings.kafka_bootstrap.partition(":")
    try:
        with socket.create_connection((host or "localhost", int(port or 9092)), timeout=3):
            return True
    except OSError:
        return False


@router.get("/status")
async def status() -> dict[str, Any]:
    reachable = await asyncio.to_thread(_kafka_reachable)
    return {"bootstrap": settings.kafka_bootstrap, "reachable": reachable}
