"""Notebooks: ordered cells executed against Spark Connect."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, queries, spark

router = APIRouter(prefix="/notebooks", tags=["notebooks"])


class CellIn(BaseModel):
    id: str
    language: str = "sql"        # sql | markdown
    source: str = ""


class NotebookIn(BaseModel):
    name: str
    cells: list[CellIn] = []
    default_language: str = "sql"
    folder_id: str | None = None


def _hydrate(row: dict[str, Any]) -> dict[str, Any]:
    row["cells"] = db.loads(row.get("cells"), [])
    row["favorite"] = bool(row.get("favorite"))
    return row


@router.get("")
async def list_notebooks() -> list[dict[str, Any]]:
    return [_hydrate(r) for r in db.query("SELECT * FROM notebooks ORDER BY updated_at DESC")]


@router.post("")
async def create_notebook(body: NotebookIn) -> dict[str, Any]:
    nid = db.new_id()
    ts = db.now()
    db.execute(
        "INSERT INTO notebooks (id, name, folder_id, cells, default_language, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?)",
        (nid, body.name, body.folder_id, db.dumps([c.model_dump() for c in body.cells]),
         body.default_language, ts, ts),
    )
    return await get_notebook(nid)


@router.get("/{nid}")
async def get_notebook(nid: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM notebooks WHERE id = ?", (nid,))
    if not row:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return _hydrate(row)


class NotebookPatch(BaseModel):
    name: str | None = None
    cells: list[CellIn] | None = None
    default_language: str | None = None
    favorite: bool | None = None


@router.patch("/{nid}")
async def update_notebook(nid: str, body: NotebookPatch) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM notebooks WHERE id = ?", (nid,)):
        raise HTTPException(status_code=404, detail="Notebook not found")
    fields, params = [], []
    if body.name is not None:
        fields.append("name = ?"); params.append(body.name)
    if body.cells is not None:
        fields.append("cells = ?"); params.append(db.dumps([c.model_dump() for c in body.cells]))
    if body.default_language is not None:
        fields.append("default_language = ?"); params.append(body.default_language)
    if body.favorite is not None:
        fields.append("favorite = ?"); params.append(1 if body.favorite else 0)
    fields.append("updated_at = ?"); params.append(db.now())
    params.append(nid)
    db.execute(f"UPDATE notebooks SET {', '.join(fields)} WHERE id = ?", params)
    return await get_notebook(nid)


@router.delete("/{nid}")
async def delete_notebook(nid: str) -> dict[str, str]:
    db.execute("DELETE FROM notebooks WHERE id = ?", (nid,))
    return {"status": "deleted"}


class RunCellIn(BaseModel):
    source: str
    language: str = "sql"


@router.post("/{nid}/cells/{cell_id}/run")
async def run_cell(nid: str, cell_id: str, body: RunCellIn) -> dict[str, Any]:
    if body.language == "markdown" or not body.source.strip():
        return {"status": "SKIPPED", "columns": [], "rows": [], "row_count": 0}
    statements = spark.split_statements(body.source)
    if not statements:
        return {"status": "SKIPPED", "columns": [], "rows": [], "row_count": 0}

    def run_all() -> dict[str, Any]:
        last: dict[str, Any] = {}
        for stmt in statements:
            last = queries.run_blocking(stmt, source="notebook", source_id=f"{nid}:{cell_id}")
            if last["status"] != "FINISHED":
                break
        return last

    return await asyncio.to_thread(run_all)


@router.post("/{nid}/run")
async def run_all_cells(nid: str) -> dict[str, Any]:
    notebook = await get_notebook(nid)

    def run_all() -> list[dict[str, Any]]:
        results = []
        for cell in notebook["cells"]:
            if cell.get("language") == "markdown" or not cell.get("source", "").strip():
                continue
            outcome: dict[str, Any] = {"status": "SKIPPED"}
            for stmt in spark.split_statements(cell["source"]):
                outcome = queries.run_blocking(stmt, source="notebook", source_id=f"{nid}:{cell['id']}")
                if outcome["status"] != "FINISHED":
                    break
            results.append({"cell_id": cell["id"], **outcome})
            if outcome.get("status") == "FAILED":
                break
        return results

    return {"results": await asyncio.to_thread(run_all)}
