"use client";

import { ArrowRight, GitBranch } from "lucide-react";
import Link from "next/link";
import React from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { DataTable, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

function tableHref(fullName: string): string | null {
  const parts = fullName.split(".");
  if (parts.length !== 3) return null;
  return `/catalog/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
}

export default function LineagePage() {
  const graph = useAsync(() => api.lineage.graph(), []);

  return (
    <div className="pb-10">
      <PageHeader
        title="Lineage"
        description="Table relationships derived from the SQL this workspace has executed"
      />

      <div className="px-6">
        <div
          className="mb-4 rounded-[4px] p-3"
          style={{ background: "var(--bg-info)", border: "1px solid var(--border)", fontSize: 12 }}
        >
          Unity Catalog OSS records no lineage of its own. Every edge below comes from a statement that read one table
          and wrote another — so lineage grows as you use the workspace.
        </div>

        {graph.loading && <Skeleton style={{ height: 180 }} />}
        {graph.error && <ErrorBanner message={graph.error} onRetry={graph.reload} />}

        {graph.data && graph.data.edges.length === 0 && (
          <EmptyState
            icon={<GitBranch size={28} />}
            title="No lineage recorded yet"
            description="Run an INSERT INTO … SELECT, a MERGE, or a CREATE TABLE AS SELECT and the relationship appears here."
          />
        )}

        {graph.data && graph.data.edges.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={graph.data.edges}
              keyOf={(row, i) => `${row.source}->${row.target}-${i}`}
              columns={[
                {
                  key: "flow",
                  header: "Relationship",
                  render: (row) => {
                    const sourceHref = tableHref(row.source);
                    const targetHref = tableHref(row.target);
                    return (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {sourceHref ? <Link href={sourceHref} className="mono">{row.source}</Link> : <span className="mono">{row.source}</span>}
                        <ArrowRight size={13} style={{ color: "var(--action-icon-default)" }} />
                        {targetHref ? <Link href={targetHref} className="mono">{row.target}</Link> : <span className="mono">{row.target}</span>}
                      </span>
                    );
                  },
                },
                { key: "count", header: "Statements", align: "right", width: 110, render: (row) => row.count },
                { key: "seen", header: "Last seen", width: 170, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.last_seen)}</span> },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
