"""Workspace tree, global search, recents and favourites."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import db, uc

router = APIRouter(prefix="/workspace", tags=["workspace"])

_KINDS = (
    ("notebooks", "notebook", "/notebooks/{id}"),
    ("saved_queries", "query", "/sql-editor?query={id}"),
    ("dashboards", "dashboard", "/dashboards/{id}"),
)


class FolderIn(BaseModel):
    name: str
    parent_id: str | None = None


@router.get("/folders")
async def folders() -> list[dict[str, Any]]:
    return db.query("SELECT * FROM folders ORDER BY name")


@router.post("/folders")
async def create_folder(body: FolderIn) -> dict[str, Any]:
    fid = db.new_id()
    db.execute(
        "INSERT INTO folders (id, name, parent_id, created_at) VALUES (?,?,?,?)",
        (fid, body.name, body.parent_id, db.now()),
    )
    return db.query_one("SELECT * FROM folders WHERE id = ?", (fid,)) or {}


@router.delete("/folders/{fid}")
async def delete_folder(fid: str) -> dict[str, str]:
    db.execute("DELETE FROM folders WHERE id = ?", (fid,))
    return {"status": "deleted"}


@router.get("/objects")
async def objects(folder_id: str | None = None) -> list[dict[str, Any]]:
    """Every workspace object, optionally scoped to one folder."""
    out: list[dict[str, Any]] = []
    for table, kind, href in _KINDS:
        clause = "WHERE folder_id IS ?" if folder_id is None else "WHERE folder_id = ?"
        rows = db.query(f"SELECT * FROM {table} {clause} ORDER BY updated_at DESC", (folder_id,))
        for row in rows:
            out.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "kind": kind,
                    "href": href.format(id=row["id"]),
                    "updated_at": row.get("updated_at"),
                    "created_at": row.get("created_at"),
                    "favorite": bool(row.get("favorite")),
                    "folder_id": row.get("folder_id"),
                }
            )
    out.sort(key=lambda o: o.get("updated_at") or "", reverse=True)
    return out


@router.get("/favorites")
async def favorites() -> list[dict[str, Any]]:
    return [o for o in await objects(None) if o["favorite"]] + [
        o for o in await objects("__never__") if o["favorite"]
    ]


class RecentIn(BaseModel):
    kind: str
    object_id: str
    name: str
    href: str


@router.post("/recents")
async def track_recent(body: RecentIn) -> dict[str, str]:
    db.execute("DELETE FROM recents WHERE kind = ? AND object_id = ?", (body.kind, body.object_id))
    db.execute(
        "INSERT INTO recents (id, kind, object_id, name, href, visited_at) VALUES (?,?,?,?,?,?)",
        (db.new_id(), body.kind, body.object_id, body.name, body.href, db.now()),
    )
    db.execute(
        "DELETE FROM recents WHERE id NOT IN (SELECT id FROM recents ORDER BY visited_at DESC LIMIT 50)"
    )
    return {"status": "ok"}


@router.get("/recents")
async def recents(limit: int = Query(20, ge=1, le=50)) -> list[dict[str, Any]]:
    return db.query("SELECT * FROM recents ORDER BY visited_at DESC LIMIT ?", (limit,))


@router.get("/search")
async def search(q: str = Query(..., min_length=1), limit: int = Query(30, ge=1, le=100)) -> list[dict[str, Any]]:
    """Global search across workspace objects and Unity Catalog assets."""
    needle = f"%{q.lower()}%"
    results: list[dict[str, Any]] = []

    for table, kind, href in _KINDS:
        for row in db.query(
            f"SELECT id, name FROM {table} WHERE LOWER(name) LIKE ? LIMIT ?", (needle, limit)
        ):
            results.append(
                {"kind": kind, "name": row["name"], "id": row["id"], "href": href.format(id=row["id"]), "subtitle": kind.title()}
            )

    for row in db.query("SELECT id, name FROM jobs WHERE LOWER(name) LIKE ? LIMIT ?", (needle, limit)):
        results.append({"kind": "job", "name": row["name"], "id": row["id"], "href": f"/jobs/{row['id']}", "subtitle": "Job"})
    for row in db.query("SELECT id, name FROM pipelines WHERE LOWER(name) LIKE ? LIMIT ?", (needle, limit)):
        results.append({"kind": "pipeline", "name": row["name"], "id": row["id"], "href": f"/pipelines/{row['id']}", "subtitle": "Pipeline"})
    for row in db.query("SELECT id, name FROM alerts WHERE LOWER(name) LIKE ? LIMIT ?", (needle, limit)):
        results.append({"kind": "alert", "name": row["name"], "id": row["id"], "href": f"/alerts/{row['id']}", "subtitle": "Alert"})

    # Catalog assets: catalogs, schemas and tables whose name contains the query.
    try:
        catalogs = await uc.list_catalogs()
        for cat in catalogs:
            if q.lower() in cat["name"].lower():
                results.append({"kind": "catalog", "name": cat["name"], "id": cat["name"], "href": f"/catalog/{cat['name']}", "subtitle": "Catalog"})
            try:
                schemas = await uc.list_schemas(cat["name"])
            except uc.UCError:
                continue
            for sch in schemas:
                full_schema = f"{cat['name']}.{sch['name']}"
                if q.lower() in sch["name"].lower():
                    results.append({"kind": "schema", "name": full_schema, "id": full_schema, "href": f"/catalog/{cat['name']}/{sch['name']}", "subtitle": "Schema"})
                try:
                    tables = await uc.list_tables(cat["name"], sch["name"])
                except uc.UCError:
                    continue
                for tbl in tables:
                    if q.lower() in tbl["name"].lower():
                        full = f"{full_schema}.{tbl['name']}"
                        results.append(
                            {"kind": "table", "name": full, "id": full, "href": f"/catalog/{cat['name']}/{sch['name']}/{tbl['name']}", "subtitle": f"{tbl.get('table_type', 'TABLE')} · {tbl.get('data_source_format', '')}".strip(" ·")}
                        )
    except uc.UCError:
        pass

    return results[:limit]


@router.get("/summary")
async def summary() -> dict[str, Any]:
    """Counters for the home page."""
    def count(table: str) -> int:
        row = db.query_one(f"SELECT COUNT(*) AS n FROM {table}")
        return int((row or {}).get("n") or 0)

    catalog_stats = {"catalogs": 0, "schemas": 0, "tables": 0}
    try:
        catalogs = await uc.list_catalogs()
        catalog_stats["catalogs"] = len(catalogs)
        for cat in catalogs:
            schemas = await uc.list_schemas(cat["name"])
            catalog_stats["schemas"] += len(schemas)
            for sch in schemas:
                catalog_stats["tables"] += len(await uc.list_tables(cat["name"], sch["name"]))
    except uc.UCError:
        pass

    return {
        "catalog": catalog_stats,
        "notebooks": count("notebooks"),
        "queries": count("saved_queries"),
        "dashboards": count("dashboards"),
        "jobs": count("jobs"),
        "pipelines": count("pipelines"),
        "alerts": count("alerts"),
        "runs_today": int((db.query_one(
            "SELECT COUNT(*) AS n FROM job_runs WHERE started_at >= date('now')"
        ) or {}).get("n") or 0),
        "queries_today": int((db.query_one(
            "SELECT COUNT(*) AS n FROM query_history WHERE started_at >= date('now')"
        ) or {}).get("n") or 0),
    }
