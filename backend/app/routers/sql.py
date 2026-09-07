"""SQL editor: execution, cancellation, history, saved queries, exports."""
from __future__ import annotations

import asyncio
import csv
import io
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import db, queries, spark, uc

router = APIRouter(prefix="/sql", tags=["sql"])


class ExecuteIn(BaseModel):
    sql: str
    limit: int | None = None
    source: str = "editor"
    source_id: str | None = None


@router.post("/execute")
async def execute(body: ExecuteIn) -> dict[str, Any]:
    """Run a statement. Returns immediately with a RUNNING record."""
    statements = spark.split_statements(body.sql)
    if not statements:
        raise HTTPException(status_code=400, detail="No statement to run.")
    if len(statements) > 1:
        # Multi-statement scripts run sequentially in one background call.
        return await asyncio.to_thread(_run_script, statements, body)
    return queries.submit_query(statements[0], source=body.source, source_id=body.source_id, limit=body.limit)


def _run_script(statements: list[str], body: ExecuteIn) -> dict[str, Any]:
    results = []
    for stmt in statements:
        outcome = queries.run_blocking(stmt, source=body.source, source_id=body.source_id, limit=body.limit)
        results.append(outcome)
        if outcome["status"] != "FINISHED":
            break
    last = results[-1]
    return {
        "id": last["id"],
        "status": last["status"],
        "statements": len(statements),
        "script": True,
        "results": results,
        **{k: v for k, v in last.items() if k in {"columns", "rows", "row_count", "error", "duration_ms"}},
    }


@router.get("/queries/{query_id}")
async def query_status(query_id: str) -> dict[str, Any]:
    record = queries.get_result(query_id)
    if record is None:
        row = db.query_one("SELECT * FROM query_history WHERE id = ?", (query_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Unknown query id")
        row["referenced_tables"] = db.loads(row.get("referenced_tables"), [])
        return {**row, "columns": [], "rows": [], "expired": True}
    return {k: v for k, v in record.items() if not k.startswith("_")}


@router.post("/queries/{query_id}/cancel")
async def cancel_query(query_id: str) -> dict[str, Any]:
    ok = queries.cancel(query_id)
    return {"cancelled": ok}


@router.get("/history")
async def history(
    limit: int = Query(100, ge=1, le=1000),
    status: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    return queries.history(limit=limit, status=status, search=search)


@router.get("/history/stats")
async def history_stats() -> dict[str, Any]:
    rows = db.query(
        "SELECT status, COUNT(*) AS n, AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms"
        " FROM query_history GROUP BY status"
    )
    total = sum(int(r["n"]) for r in rows)
    finished = next((r for r in rows if r["status"] == "FINISHED"), None)
    recent = db.query(
        "SELECT id, sql, status, duration_ms, started_at, row_count FROM query_history"
        " WHERE status = 'FINISHED' ORDER BY duration_ms DESC LIMIT 10"
    )
    return {
        "total": total,
        "by_status": {r["status"]: int(r["n"]) for r in rows},
        "avg_duration_ms": round(float(finished["avg_ms"]), 1) if finished and finished["avg_ms"] else 0,
        "max_duration_ms": int(finished["max_ms"]) if finished and finished["max_ms"] else 0,
        "slowest": recent,
    }


@router.get("/queries/{query_id}/export")
async def export_csv(query_id: str):
    record = queries.get_result(query_id)
    if not record or record.get("status") != "FINISHED":
        raise HTTPException(status_code=404, detail="No completed result for this query.")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([c["name"] for c in record.get("columns", [])])
    for row in record.get("rows", []):
        writer.writerow(row)
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="query-{query_id[:8]}.csv"'},
    )


# ---------------------------------------------------------------- saved queries


class SavedQueryIn(BaseModel):
    name: str
    sql: str
    description: str = ""
    folder_id: str | None = None
    tags: list[str] = []


@router.get("/saved")
async def list_saved() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM saved_queries ORDER BY updated_at DESC")
    for row in rows:
        row["tags"] = db.loads(row.get("tags"), [])
        row["favorite"] = bool(row.get("favorite"))
    return rows


@router.post("/saved")
async def create_saved(body: SavedQueryIn) -> dict[str, Any]:
    qid = db.new_id()
    ts = db.now()
    db.execute(
        "INSERT INTO saved_queries (id, name, description, sql, folder_id, tags, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (qid, body.name, body.description, body.sql, body.folder_id, db.dumps(body.tags), ts, ts),
    )
    return await get_saved(qid)


@router.get("/saved/{qid}")
async def get_saved(qid: str) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM saved_queries WHERE id = ?", (qid,))
    if not row:
        raise HTTPException(status_code=404, detail="Query not found")
    row["tags"] = db.loads(row.get("tags"), [])
    row["favorite"] = bool(row.get("favorite"))
    return row


class SavedQueryPatch(BaseModel):
    name: str | None = None
    sql: str | None = None
    description: str | None = None
    folder_id: str | None = None
    tags: list[str] | None = None
    favorite: bool | None = None


@router.patch("/saved/{qid}")
async def update_saved(qid: str, body: SavedQueryPatch) -> dict[str, Any]:
    existing = db.query_one("SELECT * FROM saved_queries WHERE id = ?", (qid,))
    if not existing:
        raise HTTPException(status_code=404, detail="Query not found")
    fields, params = [], []
    for column, value in (
        ("name", body.name),
        ("sql", body.sql),
        ("description", body.description),
        ("folder_id", body.folder_id),
    ):
        if value is not None:
            fields.append(f"{column} = ?")
            params.append(value)
    if body.tags is not None:
        fields.append("tags = ?")
        params.append(db.dumps(body.tags))
    if body.favorite is not None:
        fields.append("favorite = ?")
        params.append(1 if body.favorite else 0)
    fields.append("updated_at = ?")
    params.append(db.now())
    params.append(qid)
    db.execute(f"UPDATE saved_queries SET {', '.join(fields)} WHERE id = ?", params)
    return await get_saved(qid)


@router.delete("/saved/{qid}")
async def delete_saved(qid: str) -> dict[str, str]:
    db.execute("DELETE FROM saved_queries WHERE id = ?", (qid,))
    return {"status": "deleted"}


# ------------------------------------------------------------------ completion


@router.get("/completion")
async def completion(catalog: str | None = None, schema: str | None = None) -> dict[str, Any]:
    """Identifier metadata the editor's autocomplete consumes."""
    out: dict[str, Any] = {"catalogs": [], "schemas": [], "tables": [], "columns": {}, "functions": []}
    try:
        catalogs = await uc.list_catalogs()
        out["catalogs"] = [c["name"] for c in catalogs]
        target_catalogs = [catalog] if catalog else out["catalogs"]
        for cat in target_catalogs:
            try:
                schemas = await uc.list_schemas(cat)
            except uc.UCError:
                continue
            for sch in schemas:
                out["schemas"].append(f"{cat}.{sch['name']}")
                if schema and sch["name"] != schema:
                    continue
                try:
                    tables = await uc.list_tables(cat, sch["name"])
                    functions = await uc.list_functions(cat, sch["name"])
                except uc.UCError:
                    continue
                for tbl in tables:
                    full = f"{cat}.{sch['name']}.{tbl['name']}"
                    out["tables"].append(full)
                    out["columns"][full] = [
                        {"name": c["name"], "type": c.get("type_text") or c.get("type_name")}
                        for c in (tbl.get("columns") or [])
                    ]
                out["functions"].extend(f"{cat}.{sch['name']}.{fn['name']}" for fn in functions)
    except uc.UCError:
        pass
    return out
