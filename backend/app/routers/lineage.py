"""Table lineage derived from executed SQL.

Unity Catalog OSS records no lineage, so we build it from query history: every
statement that reads from one table and writes to another contributes an edge.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter

from .. import db, spark

router = APIRouter(prefix="/lineage", tags=["lineage"])

_WRITE = re.compile(
    r"\b(?:insert\s+into|insert\s+overwrite(?:\s+table)?|create\s+(?:or\s+replace\s+)?"
    r"(?:table|view)(?:\s+if\s+not\s+exists)?|merge\s+into|update)\s+"
    r"([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*){0,2})",
    re.I,
)


def _edges() -> tuple[list[dict[str, Any]], set[str]]:
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    nodes: set[str] = set()

    rows = db.query(
        "SELECT id, sql, started_at, status FROM query_history WHERE status = 'FINISHED'"
        " ORDER BY started_at DESC LIMIT 2000"
    )
    for row in rows:
        sql = row["sql"]
        target_match = _WRITE.search(spark.strip_comments(sql))
        if not target_match:
            continue
        target = target_match.group(1)
        sources = [t for t in spark.referenced_tables(sql) if t.lower() != target.lower()]
        nodes.add(target)
        for source in sources:
            nodes.add(source)
            key = (source, target)
            entry = edges.setdefault(
                key,
                {"source": source, "target": target, "count": 0, "last_seen": row["started_at"], "query_id": row["id"]},
            )
            entry["count"] += 1
            if row["started_at"] > entry["last_seen"]:
                entry["last_seen"] = row["started_at"]
                entry["query_id"] = row["id"]
    return list(edges.values()), nodes


@router.get("/graph")
async def graph() -> dict[str, Any]:
    edges, nodes = _edges()
    return {
        "nodes": [{"id": n, "name": n.split(".")[-1], "full_name": n} for n in sorted(nodes)],
        "edges": edges,
    }


@router.get("/table/{full_name}")
async def table_lineage(full_name: str) -> dict[str, Any]:
    """Upstream and downstream neighbours of one table."""
    edges, _ = _edges()
    short = full_name.split(".")[-1].lower()

    def matches(name: str) -> bool:
        return name.lower() == full_name.lower() or name.split(".")[-1].lower() == short

    upstream = [e for e in edges if matches(e["target"])]
    downstream = [e for e in edges if matches(e["source"])]
    return {
        "table": full_name,
        "upstream": upstream,
        "downstream": downstream,
        "has_lineage": bool(upstream or downstream),
    }
