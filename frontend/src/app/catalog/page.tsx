"use client";

import { Database, Plus } from "lucide-react";
import Link from "next/link";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, DataTable, EmptyState, ErrorBanner, Field, Input, Modal, SearchInput, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function CatalogPage() {
  const catalogs = useAsync(() => api.catalog.catalogs(), []);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = (catalogs.data ?? []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.catalog.createCatalog({ name: name.trim(), comment });
      toast(`Catalog “${name}” created`, "success");
      setCreating(false);
      setName("");
      setComment("");
      catalogs.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create catalog", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Catalog"
        description="Unity Catalog — the metadata layer for every table in the lakehouse"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create catalog
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter catalogs" className="mb-3 max-w-xs" />

        {catalogs.loading && <Skeleton style={{ height: 160 }} />}
        {catalogs.error && <ErrorBanner message={catalogs.error} onRetry={catalogs.reload} />}

        {catalogs.data && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.name}
              emptyMessage="No catalogs found."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <Link href={`/catalog/${encodeURIComponent(row.name)}`} className="inline-flex items-center gap-2 font-medium">
                      <Database size={14} style={{ color: "var(--action-icon-default)" }} />
                      {row.name}
                    </Link>
                  ),
                },
                {
                  key: "schemas",
                  header: "Schemas",
                  align: "right",
                  width: 100,
                  render: (row) => formatNumber(row.schema_count ?? 0),
                },
                {
                  key: "comment",
                  header: "Comment",
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.comment || "—"}</span>,
                },
                {
                  key: "created",
                  header: "Created",
                  width: 190,
                  render: (row) => (
                    <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.created_at)}</span>
                  ),
                },
              ]}
            />
          </div>
        )}

        {catalogs.data?.length === 0 && (
          <EmptyState
            icon={<Database size={28} />}
            title="No catalogs yet"
            description="Create a catalog to start organising schemas and tables."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create catalog</Button>}
          />
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create catalog"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Catalog name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="analytics" autoFocus />
          </Field>
          <Field label="Comment">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What lives in this catalog?" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
