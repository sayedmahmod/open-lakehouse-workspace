"""AI cell editing — provider status, settings and a streamed edit endpoint."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import ai

router = APIRouter(prefix="/ai", tags=["ai"])


def _status_payload() -> dict[str, Any]:
    return {"providers": ai.detect(), "active": ai.active(), "usage": ai.usage_summary()}


@router.get("/status")
async def status() -> dict[str, Any]:
    return _status_payload()


class SettingsIn(BaseModel):
    provider: str
    model: str = ""
    reasoning_effort: str = ""


@router.put("/settings")
async def save_settings(body: SettingsIn) -> dict[str, Any]:
    try:
        ai.set_active(body.provider, body.model, body.reasoning_effort)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _status_payload()


@router.post("/usage/reset")
async def usage_reset() -> dict[str, Any]:
    return ai.reset_usage()


class InstallIn(BaseModel):
    provider: str


@router.post("/install")
async def install(body: InstallIn) -> dict[str, Any]:
    try:
        result = await ai.install(body.provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {**result, "status": _status_payload()}


class Selection(BaseModel):
    start: int
    end: int


class EditContext(BaseModel):
    tables: list[str] = Field(default_factory=list)


class EditIn(BaseModel):
    source: str
    language: str = "sql"
    instruction: str = ""
    selection: Selection | None = None
    context: EditContext | None = None
    surface: str = ""


@router.post("/edit")
async def edit(body: EditIn) -> StreamingResponse:
    active = ai.active()
    provider, model = active["provider"], active["model"]
    reasoning_effort = active["reasoning_effort"]
    selection = body.selection.model_dump() if body.selection else None
    prompt = ai.build_prompt(
        source=body.source,
        language=body.language,
        instruction=body.instruction,
        selection=selection,
        available_tables=body.context.tables if body.context else None,
    )

    async def gen():
        final: dict[str, Any] | None = None
        try:
            async for event in ai.stream_edit(
                provider=provider,
                model=model,
                reasoning_effort=reasoning_effort,
                prompt=prompt,
            ):
                if event.get("type") == "done":
                    validation_error = ai.validate_generated_output(
                        body.language, str(event.get("output") or "")
                    )
                    if validation_error:
                        event = {
                            **event,
                            "type": "error",
                            "message": validation_error,
                        }
                if event.get("type") in ("done", "error"):
                    final = event
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # noqa: BLE001 — surface any spawn failure to the client
            final = {"type": "error", "message": str(exc)}
            yield f"data: {json.dumps(final)}\n\n"
        ai.record_usage(
            provider=provider,
            model=model,
            surface=body.surface,
            ok=bool(final and final.get("type") == "done"),
            usage=(final or {}).get("usage") or {},
            duration_ms=(final or {}).get("duration_ms") or 0,
        )

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
