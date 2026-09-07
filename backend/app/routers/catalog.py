"""Catalog Explorer endpoints backed by Unity Catalog + Spark."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import db, spark, uc
from ..config import settings

router = APIRouter(prefix="/catalog", tags=["catalog"])


def _uc_guard(exc: uc.UCError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/catalogs")
async def catalogs() -> list[dict[str, Any]]:
    try:
        rows = await uc.list_catalogs()
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    # Enrich with schema counts so the tree can show them without a second trip.
    async def enrich(cat: dict) -> dict:
        try:
            schemas = await uc.list_schemas(cat["name"])
        except uc.UCError:
            schemas = []
        return {**cat, "schema_count": len(schemas)}

    return list(await asyncio.gather(*(enrich(c) for c in rows)))


class CatalogIn(BaseModel):
    name: str
    comment: str = ""
    storage_root: str | None = None


@router.post("/catalogs")
async def create_catalog(body: CatalogIn) -> dict[str, Any]:
    try:
        return await uc.create_catalog(body.name, body.comment, body.storage_root)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc


@router.delete("/catalogs/{name}")
async def drop_catalog(name: str, force: bool = False) -> dict[str, str]:
    try:
        await uc.delete_catalog(name, force)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    return {"status": "deleted"}


@router.get("/catalogs/{catalog}/schemas")
async def schemas(catalog: str) -> list[dict[str, Any]]:
    try:
        rows = await uc.list_schemas(catalog)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc

    async def enrich(schema: dict) -> dict:
        try:
            tables, volumes, functions = await asyncio.gather(
                uc.list_tables(catalog, schema["name"]),
                uc.list_volumes(catalog, schema["name"]),
                uc.list_functions(catalog, schema["name"]),
            )
        except uc.UCError:
            tables, volumes, functions = [], [], []
        return {
            **schema,
            "table_count": len(tables),
            "volume_count": len(volumes),
            "function_count": len(functions),
        }

    return list(await asyncio.gather(*(enrich(s) for s in rows)))


class SchemaIn(BaseModel):
    name: str
    comment: str = ""


@router.post("/catalogs/{catalog}/schemas")
async def create_schema(catalog: str, body: SchemaIn) -> dict[str, Any]:
    try:
        return await uc.create_schema(catalog, body.name, body.comment)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc


@router.delete("/schemas/{full_name}")
async def drop_schema(full_name: str, force: bool = False) -> dict[str, str]:
    try:
        await uc.delete_schema(full_name, force)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    return {"status": "deleted"}


@router.get("/catalogs/{catalog}/schemas/{schema}/objects")
async def schema_objects(catalog: str, schema: str) -> dict[str, Any]:
    """Everything inside a schema, in one round trip, for the schema page."""
    try:
        tables, volumes, functions, models = await asyncio.gather(
            uc.list_tables(catalog, schema),
            uc.list_volumes(catalog, schema),
            uc.list_functions(catalog, schema),
            uc.list_models(catalog, schema),
        )
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    return {"tables": tables, "volumes": volumes, "functions": functions, "models": models}



def _columns_via_spark(full_name: str) -> list[dict[str, Any]]:
    """Read a table's schema from Spark.

    Unity Catalog OSS 0.4.x registers tables created through the Spark
    connector without column metadata, so `columns` comes back empty for
    everything this workspace creates. DESCRIBE gives us the real schema.
    """
    try:
        described = spark.run_sql(f"DESCRIBE TABLE {full_name}", limit=500)
    except Exception:
        return []

    names = [c["name"] for c in described.get("columns", [])]
    try:
        i_name = names.index("col_name")
        i_type = names.index("data_type")
    except ValueError:
        return []
    i_comment = names.index("comment") if "comment" in names else None

    out: list[dict[str, Any]] = []
    for position, row in enumerate(described.get("rows", [])):
        col_name = (row[i_name] or "").strip()
        # DESCRIBE appends a blank line then partition metadata; stop there.
        if not col_name or col_name.startswith("#"):
            break
        out.append(
            {
                "name": col_name,
                "type_text": row[i_type],
                "type_name": (row[i_type] or "").split("(")[0].upper(),
                "comment": row[i_comment] if i_comment is not None else None,
                "nullable": True,
                "position": position,
                "partition_index": None,
            }
        )
    return out


@router.get("/tables/{full_name}")
async def table_detail(full_name: str) -> dict[str, Any]:
    try:
        table = await uc.get_table(full_name)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    if not table.get("columns"):
        table["columns"] = await asyncio.to_thread(_columns_via_spark, full_name)
    override = db.query_one("SELECT * FROM table_comments WHERE full_name = ?", (full_name,))
    if override:
        table["comment"] = override["comment"]
    return table


@router.delete("/tables/{full_name}")
async def drop_table(full_name: str) -> dict[str, str]:
    try:
        await uc.delete_table(full_name)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    return {"status": "deleted"}


class CommentIn(BaseModel):
    comment: str


@router.put("/tables/{full_name}/comment")
async def set_comment(full_name: str, body: CommentIn) -> dict[str, str]:
    db.execute(
        "INSERT INTO table_comments (full_name, comment, updated_at) VALUES (?,?,?)"
        " ON CONFLICT(full_name) DO UPDATE SET comment=excluded.comment, updated_at=excluded.updated_at",
        (full_name, body.comment, db.now()),
    )
    return {"status": "saved"}


def _run(sql: str, limit: int | None = None) -> dict[str, Any]:
    return spark.run_sql(sql, limit=limit)


@router.get("/tables/{full_name}/sample")
async def table_sample(full_name: str, limit: int = Query(100, ge=1, le=1000)) -> dict[str, Any]:
    """Sample Data tab — a real SELECT against the table."""
    try:
        return await asyncio.to_thread(_run, f"SELECT * FROM {full_name} LIMIT {limit}", limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/tables/{full_name}/history")
async def table_history(full_name: str, limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    """Delta transaction log — powers the History tab and time travel."""
    try:
        return await asyncio.to_thread(_run, f"DESCRIBE HISTORY {full_name} LIMIT {limit}", limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/tables/{full_name}/detail")
async def table_detail_spark(full_name: str) -> dict[str, Any]:
    """DESCRIBE DETAIL — size on disk, file count, partition columns."""
    try:
        return await asyncio.to_thread(_run, f"DESCRIBE DETAIL {full_name}", 1)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/tables/{full_name}/profile")
async def table_profile(full_name: str, limit: int = Query(20, ge=1, le=60)) -> dict[str, Any]:
    """Column statistics for the table insights panel."""
    try:
        table = await uc.get_table(full_name)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc

    columns = table.get("columns") or await asyncio.to_thread(_columns_via_spark, full_name)
    numeric_types = {"INT", "LONG", "SHORT", "BYTE", "FLOAT", "DOUBLE", "DECIMAL"}
    selected = columns[:limit]
    if not selected:
        return {"row_count": 0, "columns": []}

    parts = ["COUNT(*) AS __rows"]
    for i, col in enumerate(selected):
        name = f"`{col['name']}`"
        parts.append(f"COUNT({name}) AS c{i}_nonnull")
        parts.append(f"COUNT(DISTINCT {name}) AS c{i}_distinct")
        if (col.get("type_name") or "").upper() in numeric_types:
            parts.append(f"CAST(MIN({name}) AS DOUBLE) AS c{i}_min")
            parts.append(f"CAST(MAX({name}) AS DOUBLE) AS c{i}_max")
            parts.append(f"CAST(AVG({name}) AS DOUBLE) AS c{i}_avg")

    sql = f"SELECT {', '.join(parts)} FROM {full_name}"
    try:
        result = await asyncio.to_thread(_run, sql, 1)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    names = [c["name"] for c in result["columns"]]
    values = result["rows"][0] if result["rows"] else []
    lookup = dict(zip(names, values))
    total = int(lookup.get("__rows") or 0)

    out = []
    for i, col in enumerate(selected):
        non_null = int(lookup.get(f"c{i}_nonnull") or 0)
        out.append(
            {
                "name": col["name"],
                "type": col.get("type_text") or col.get("type_name"),
                "comment": col.get("comment"),
                "nullable": col.get("nullable", True),
                "non_null": non_null,
                "null_count": max(0, total - non_null),
                "null_pct": round((total - non_null) / total * 100, 2) if total else 0.0,
                "distinct": int(lookup.get(f"c{i}_distinct") or 0),
                "min": lookup.get(f"c{i}_min"),
                "max": lookup.get(f"c{i}_max"),
                "avg": lookup.get(f"c{i}_avg"),
            }
        )
    return {"row_count": total, "columns": out}


@router.get("/volumes/{full_name}")
async def volume_detail(full_name: str) -> dict[str, Any]:
    try:
        return await uc.get_volume(full_name)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc


@router.get("/functions/{full_name}")
async def function_detail(full_name: str) -> dict[str, Any]:
    try:
        return await uc.get_function(full_name)
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc


@router.get("/external-locations")
async def external_locations() -> dict[str, Any]:
    try:
        locations, credentials = await asyncio.gather(uc.list_external_locations(), uc.list_credentials())
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
    return {"external_locations": locations, "credentials": credentials, "storage_root": settings.warehouse_root}


@router.get("/tree")
async def tree() -> list[dict[str, Any]]:
    """Flat catalog/schema listing used to hydrate the explorer sidebar."""
    try:
        cats = await uc.list_catalogs()
        out = []
        for cat in cats:
            try:
                schemas_ = await uc.list_schemas(cat["name"])
            except uc.UCError:
                schemas_ = []
            out.append({"name": cat["name"], "comment": cat.get("comment"), "schemas": [s["name"] for s in schemas_]})
        return out
    except uc.UCError as exc:
        raise _uc_guard(exc) from exc
