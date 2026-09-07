"use client";

/** Query result grid: sortable, searchable, with a copy/export affordance. */
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import React, { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { formatCell, formatDuration, formatNumber, isNumeric } from "@/lib/format";
import type { QueryResult } from "@/lib/types";
import { Badge, Button, EmptyState, SearchInput } from "../ui";

export function ResultGrid({ result }: { result: QueryResult }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    let out = result.rows;
    if (filter.trim()) {
      const needle = filter.toLowerCase();
      out = out.filter((row) => row.some((cell) => formatCell(cell).toLowerCase().includes(needle)));
    }
    if (sortCol !== null) {
      out = [...out].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        let cmp: number;
        if (isNumeric(av) && isNumeric(bv)) cmp = (av as number) - (bv as number);
        else cmp = formatCell(av).localeCompare(formatCell(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [result.rows, sortCol, sortDir, filter]);

  const toggleSort = (index: number) => {
    if (sortCol === index) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(index);
      setSortDir("asc");
    }
  };

  if (result.status === "FAILED") {
    return (
      <div className="p-4">
        <div
          className="rounded-[4px] p-3"
          style={{ background: "var(--bg-danger)", border: "1px solid var(--border-danger)" }}
        >
          <div className="mb-1 font-medium" style={{ fontSize: 13, color: "var(--text-danger)" }}>
            Query failed
          </div>
          <pre
            className="mono overflow-x-auto whitespace-pre-wrap"
            style={{ fontSize: 12, color: "var(--text-primary)", margin: 0 }}
          >
            {result.error}
          </pre>
        </div>
      </div>
    );
  }

  if (result.status === "CANCELED") {
    return <EmptyState title="Query cancelled" description="The statement was interrupted before it finished." />;
  }

  if (result.columns.length === 0) {
    return (
      <EmptyState
        title="Statement completed"
        description={`${result.statement_type ?? "The statement"} ran successfully and returned no result set.${
          result.duration_ms ? ` Took ${formatDuration(result.duration_ms)}.` : ""
        }`}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {formatNumber(result.row_count)} {result.row_count === 1 ? "row" : "rows"}
          {result.duration_ms !== undefined && ` · ${formatDuration(result.duration_ms)}`}
        </span>
        {result.truncated && (
          <Badge tone="warning">Truncated — showing the first {formatNumber(result.row_count)} rows</Badge>
        )}
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter rows" className="ml-auto w-56" />
        <Button
          size="sm"
          icon={<Download size={13} />}
          onClick={() => window.open(api.sql.exportUrl(result.id), "_blank")}
        >
          CSV
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse" style={{ fontSize: 12 }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ background: "var(--table-header-bg)" }}>
              <th
                className="px-2 py-1.5 text-right font-medium"
                style={{
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                  width: 48,
                  position: "sticky",
                  left: 0,
                  background: "var(--table-header-bg)",
                }}
              >
                #
              </th>
              {result.columns.map((col, i) => (
                <th
                  key={`${col.name}-${i}`}
                  onClick={() => toggleSort(i)}
                  className="cursor-pointer select-none px-2 py-1.5 text-left font-medium"
                  style={{
                    color: "var(--text-secondary)",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}
                  title={`${col.name} — ${col.type}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.name}
                    <span style={{ fontWeight: 400, opacity: 0.7 }}>{col.type}</span>
                    {sortCol === i ? (
                      sortDir === "asc" ? (
                        <ArrowUp size={11} />
                      ) : (
                        <ArrowDown size={11} />
                      )
                    ) : (
                      <ChevronsUpDown size={11} style={{ opacity: 0.35 }} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--table-row-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <td
                  className="mono px-2 py-1 text-right"
                  style={{
                    color: "var(--text-secondary)",
                    borderRight: "1px solid var(--border)",
                    position: "sticky",
                    left: 0,
                    background: "var(--bg-primary)",
                  }}
                >
                  {ri + 1}
                </td>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="mono px-2 py-1"
                    style={{
                      color: cell === null ? "var(--text-secondary)" : "var(--text-primary)",
                      fontStyle: cell === null ? "italic" : "normal",
                      whiteSpace: "nowrap",
                      maxWidth: 420,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: isNumeric(cell) ? "right" : "left",
                    }}
                    title={formatCell(cell)}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            No rows match “{filter}”.
          </div>
        )}
      </div>
    </div>
  );
}
