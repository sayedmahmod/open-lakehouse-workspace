"""Unity Catalog OSS REST client.

UC is the source of truth for catalogs, schemas, tables, volumes, functions
and registered models. Everything here maps 1:1 onto its /api/2.1 surface.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger("lakehouse.uc")

API = "/api/2.1/unity-catalog"


class UCError(RuntimeError):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


def _client() -> httpx.AsyncClient:
    headers = {"Accept": "application/json"}
    if settings.uc_token and settings.uc_token != "not_used":
        headers["Authorization"] = f"Bearer {settings.uc_token}"
    return httpx.AsyncClient(base_url=settings.uc_url.rstrip("/"), headers=headers, timeout=30.0)


async def request(method: str, path: str, *, params: dict | None = None, json: Any = None) -> Any:
    async with _client() as client:
        try:
            resp = await client.request(method, f"{API}{path}", params=params, json=json)
        except httpx.RequestError as exc:
            raise UCError(f"Unity Catalog unreachable at {settings.uc_url}: {exc}", 503) from exc
    if resp.status_code >= 400:
        detail = resp.text
        try:
            body = resp.json()
            detail = body.get("message") or body.get("error_code") or detail
        except Exception:
            pass
        raise UCError(detail, resp.status_code)
    if not resp.content:
        return None
    return resp.json()


async def _paged(path: str, key: str, params: dict | None = None) -> list[dict]:
    """Follow UC's next_page_token until the collection is exhausted."""
    out: list[dict] = []
    token: str | None = None
    for _ in range(50):  # hard stop; UC pages are large
        merged = dict(params or {})
        if token:
            merged["page_token"] = token
        body = await request("GET", path, params=merged) or {}
        out.extend(body.get(key) or [])
        token = body.get("next_page_token")
        if not token:
            break
    return out


async def list_catalogs() -> list[dict]:
    return await _paged("/catalogs", "catalogs")


async def get_catalog(name: str) -> dict:
    return await request("GET", f"/catalogs/{name}")


async def create_catalog(name: str, comment: str = "", storage_root: str | None = None) -> dict:
    payload: dict[str, Any] = {"name": name, "comment": comment}
    if storage_root:
        payload["storage_root"] = storage_root
    return await request("POST", "/catalogs", json=payload)


async def delete_catalog(name: str, force: bool = False) -> None:
    await request("DELETE", f"/catalogs/{name}", params={"force": str(force).lower()})


async def list_schemas(catalog: str) -> list[dict]:
    return await _paged("/schemas", "schemas", {"catalog_name": catalog})


async def get_schema(full_name: str) -> dict:
    return await request("GET", f"/schemas/{full_name}")


async def create_schema(catalog: str, name: str, comment: str = "") -> dict:
    return await request("POST", "/schemas", json={"catalog_name": catalog, "name": name, "comment": comment})


async def delete_schema(full_name: str, force: bool = False) -> None:
    await request("DELETE", f"/schemas/{full_name}", params={"force": str(force).lower()})


async def list_tables(catalog: str, schema: str) -> list[dict]:
    return await _paged("/tables", "tables", {"catalog_name": catalog, "schema_name": schema})


async def get_table(full_name: str) -> dict:
    return await request("GET", f"/tables/{full_name}")


async def delete_table(full_name: str) -> None:
    await request("DELETE", f"/tables/{full_name}")


async def list_volumes(catalog: str, schema: str) -> list[dict]:
    return await _paged("/volumes", "volumes", {"catalog_name": catalog, "schema_name": schema})


async def get_volume(full_name: str) -> dict:
    return await request("GET", f"/volumes/{full_name}")


async def list_functions(catalog: str, schema: str) -> list[dict]:
    return await _paged("/functions", "functions", {"catalog_name": catalog, "schema_name": schema})


async def get_function(full_name: str) -> dict:
    return await request("GET", f"/functions/{full_name}")


async def list_models(catalog: str, schema: str) -> list[dict]:
    return await _paged("/models", "registered_models", {"catalog_name": catalog, "schema_name": schema})


async def list_external_locations() -> list[dict]:
    return await _paged("/external-locations", "external_locations")


async def list_credentials() -> list[dict]:
    return await _paged("/credentials", "credentials")


async def health() -> dict:
    try:
        catalogs = await list_catalogs()
        return {"reachable": True, "url": settings.uc_url, "catalog_count": len(catalogs)}
    except UCError as exc:
        return {"reachable": False, "url": settings.uc_url, "error": str(exc)}
