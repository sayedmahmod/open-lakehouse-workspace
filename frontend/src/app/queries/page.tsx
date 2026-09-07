"use client";

import { FileCode2, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, DataTable, EmptyState, ErrorBanner, IconButton, SearchInput, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function QueriesPage() {
  const queries = useAsync(() => api.sql.saved(), []);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const toast = useToast();

  const rows = (queries.data ?? []).filter(
    (q) => q.name.toLowerCase().includes(search.toLowerCase()) || q.sql.toLowerCase().includes(search.toLowerCase()),
  );

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete saved query “${name}”?`)) return;
    try {
      await api.sql.deleteSaved(id);
      toast("Query deleted", "success");
      queries.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  const toggleFavorite = async (id: string, favorite: boolean) => {
    try {
      await api.sql.updateSaved(id, { favorite: !favorite });
      queries.reload();
    } catch {
      toast("Could not update", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Queries"
        description="Saved SQL you can open in the editor, schedule as a job, or drive a dashboard with"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => router.push("/sql-editor")}>
            New query
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter queries" className="mb-3 max-w-xs" />

        {queries.loading && <Skeleton style={{ height: 180 }} />}
        {queries.error && <ErrorBanner message={queries.error} onRetry={queries.reload} />}

        {queries.data && queries.data.length === 0 && (
          <EmptyState
            icon={<FileCode2 size={28} />}
            title="No saved queries yet"
            description="Write a statement in the SQL editor and save it to reuse it here."
            action={<Button variant="primary" onClick={() => router.push("/sql-editor")}>Open SQL editor</Button>}
          />
        )}

        {queries.data && queries.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/sql-editor?query=${row.id}`)}
              emptyMessage="No queries match the filter."
              columns={[
                {
                  key: "fav",
                  header: "",
                  width: 40,
                  render: (row) => (
                    <IconButton
                      title={row.favorite ? "Remove from favourites" : "Add to favourites"}
                      active={row.favorite}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(row.id, row.favorite);
                      }}
                    >
                      <Star size={13} fill={row.favorite ? "currentColor" : "none"} />
                    </IconButton>
                  ),
                },
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                {
                  key: "sql",
                  header: "Statement",
                  render: (row) => (
                    <span className="mono block truncate" style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 420 }}>
                      {row.sql.replace(/\s+/g, " ").slice(0, 120)}
                    </span>
                  ),
                },
                {
                  key: "updated",
                  header: "Updated",
                  width: 150,
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.updated_at)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  width: 44,
                  render: (row) => (
                    <IconButton
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(row.id, row.name);
                      }}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
