"use client";

import { FileCode2, LayoutDashboard, LayoutGrid, NotebookText, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, DataTable, EmptyState, ErrorBanner, SearchInput, Skeleton, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const ICONS: Record<string, React.ReactNode> = {
  notebook: <NotebookText size={14} />,
  query: <FileCode2 size={14} />,
  dashboard: <LayoutDashboard size={14} />,
};

export default function WorkspacePage() {
  const objects = useAsync(() => api.workspace.objects(), []);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const router = useRouter();

  const rows = (objects.data ?? [])
    .filter((o) => (tab === "all" ? true : tab === "favorites" ? o.favorite : o.kind === tab))
    .filter((o) => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="pb-10">
      <PageHeader title="Workspace" description="Every notebook, query and dashboard in this workspace" />

      <div className="px-6">
        <Tabs
          active={tab}
          onChange={setTab}
          className="mb-3"
          tabs={[
            { id: "all", label: "All", count: objects.data?.length },
            { id: "notebook", label: "Notebooks" },
            { id: "query", label: "Queries" },
            { id: "dashboard", label: "Dashboards" },
            { id: "favorites", label: "Favourites" },
          ]}
        />

        <SearchInput value={search} onChange={setSearch} placeholder="Filter by name" className="mb-3 max-w-xs" />

        {objects.loading && <Skeleton style={{ height: 180 }} />}
        {objects.error && <ErrorBanner message={objects.error} onRetry={objects.reload} />}

        {objects.data && objects.data.length === 0 && (
          <EmptyState
            icon={<LayoutGrid size={28} />}
            title="Workspace is empty"
            description="Create a notebook, save a query, or build a dashboard to fill it."
          />
        )}

        {objects.data && objects.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => `${row.kind}-${row.id}`}
              onRowClick={(row) => router.push(row.href)}
              emptyMessage="Nothing matches this filter."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span style={{ color: "var(--action-icon-default)" }}>{ICONS[row.kind]}</span>
                      {row.name}
                      {row.favorite && <Star size={12} fill="currentColor" style={{ color: "var(--tag-lemon)" }} />}
                    </span>
                  ),
                },
                { key: "kind", header: "Type", width: 130, render: (row) => <Badge>{row.kind}</Badge> },
                { key: "updated", header: "Updated", width: 170, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.updated_at)}</span> },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
