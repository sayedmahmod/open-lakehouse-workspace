"use client";

import { History, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, EmptyState, ErrorBanner, SearchInput, Select, Skeleton, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration, formatNumber, formatRelative } from "@/lib/format";
import { useAsync, useInterval } from "@/lib/useAsync";

export default function QueryHistoryPage() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const router = useRouter();

  const history = useAsync(() => api.sql.history({ limit: 200, status, search }), [status, search]);
  const stats = useAsync(() => api.sql.historyStats(), []);

  // Keep the list fresh while queries are still running.
  useInterval(() => {
    if ((history.data ?? []).some((h) => h.status === "RUNNING")) history.reload();
  }, 2000);

  return (
    <div className="pb-10">
      <PageHeader
        title="Query History"
        description="Every statement this workspace has executed against Spark Connect"
        actions={
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => {
              history.reload();
              stats.reload();
            }}
          >
            Refresh
          </Button>
        }
      />

      <div className="px-6">
        {stats.data && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total statements", value: formatNumber(stats.data.total) },
              { label: "Succeeded", value: formatNumber(stats.data.by_status.FINISHED ?? 0) },
              { label: "Failed", value: formatNumber(stats.data.by_status.FAILED ?? 0) },
              { label: "Average duration", value: formatDuration(stats.data.avg_duration_ms) },
            ].map((card) => (
              <div key={card.label} className="lh-card p-3">
                <div className="font-semibold" style={{ fontSize: 20, lineHeight: "26px" }}>
                  {card.value}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{card.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search statements" className="max-w-xs flex-1" />
          <Select
            value={status}
            onChange={setStatus}
            ariaLabel="Filter by status"
            className="w-44"
            options={[
              { value: "all", label: "All statuses" },
              { value: "finished", label: "Finished" },
              { value: "failed", label: "Failed" },
              { value: "running", label: "Running" },
              { value: "canceled", label: "Canceled" },
            ]}
          />
        </div>

        {history.loading && !history.data && <Skeleton style={{ height: 200 }} />}
        {history.error && <ErrorBanner message={history.error} onRetry={history.reload} />}

        {history.data && history.data.length === 0 && (
          <EmptyState icon={<History size={28} />} title="No queries yet" description="Statements you run show up here with timing and row counts." />
        )}

        {history.data && history.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              dense
              rows={history.data}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/sql-editor?sql=${encodeURIComponent(row.sql)}`)}
              columns={[
                { key: "status", header: "Status", width: 110, render: (row) => <StatusBadge status={row.status} /> },
                {
                  key: "sql",
                  header: "Statement",
                  render: (row) => (
                    <span className="mono block truncate" style={{ fontSize: 12, maxWidth: 520 }} title={row.sql}>
                      {row.sql.replace(/\s+/g, " ")}
                    </span>
                  ),
                },
                { key: "type", header: "Type", width: 90, render: (row) => <Badge>{row.statement_type ?? "—"}</Badge> },
                { key: "source", header: "Source", width: 100, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.source}</span> },
                { key: "rows", header: "Rows", align: "right", width: 90, render: (row) => (row.row_count === null || row.row_count === undefined ? "—" : formatNumber(row.row_count)) },
                { key: "duration", header: "Duration", align: "right", width: 100, render: (row) => formatDuration(row.duration_ms) },
                {
                  key: "started",
                  header: "Started",
                  width: 150,
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.started_at)}</span>,
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
