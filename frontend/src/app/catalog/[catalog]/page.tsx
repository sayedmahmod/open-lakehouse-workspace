"use client";

import { FolderTree, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, SearchInput, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function CatalogDetailPage() {
  const params = useParams<{ catalog: string }>();
  const catalog = decodeURIComponent(params.catalog);
  const router = useRouter();
  const toast = useToast();

  const schemas = useAsync(() => api.catalog.schemas(catalog), [catalog]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = (schemas.data ?? []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.catalog.createSchema(catalog, { name: name.trim(), comment });
      toast(`Schema “${name}” created`, "success");
      setCreating(false);
      setName("");
      setComment("");
      schemas.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create schema", "danger");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (fullName: string) => {
    if (!confirm(`Drop schema ${fullName}? This cannot be undone.`)) return;
    try {
      await api.catalog.dropSchema(fullName, true);
      toast(`Schema ${fullName} dropped`, "success");
      schemas.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not drop schema", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={catalog}
        breadcrumbs={[{ label: "Catalog", href: "/catalog" }, { label: catalog }]}
        description="Schemas in this catalog"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create schema
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter schemas" className="mb-3 max-w-xs" />

        {schemas.loading && <Skeleton style={{ height: 160 }} />}
        {schemas.error && <ErrorBanner message={schemas.error} onRetry={schemas.reload} />}

        {schemas.data && schemas.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.full_name}
              emptyMessage="No schemas match the filter."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <Link
                      href={`/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(row.name)}`}
                      className="inline-flex items-center gap-2 font-medium"
                    >
                      <FolderTree size={14} style={{ color: "var(--action-icon-default)" }} />
                      {row.name}
                    </Link>
                  ),
                },
                { key: "tables", header: "Tables", align: "right", width: 90, render: (row) => formatNumber(row.table_count ?? 0) },
                { key: "volumes", header: "Volumes", align: "right", width: 90, render: (row) => formatNumber(row.volume_count ?? 0) },
                { key: "functions", header: "Functions", align: "right", width: 100, render: (row) => formatNumber(row.function_count ?? 0) },
                {
                  key: "comment",
                  header: "Comment",
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.comment || "—"}</span>,
                },
                {
                  key: "created",
                  header: "Created",
                  width: 180,
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.created_at)}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  width: 44,
                  render: (row) => (
                    <IconButton
                      title="Drop schema"
                      onClick={(e) => {
                        e.stopPropagation();
                        drop(row.full_name);
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  ),
                },
              ]}
            />
          </div>
        )}

        {schemas.data?.length === 0 && (
          <EmptyState
            icon={<FolderTree size={28} />}
            title="No schemas in this catalog"
            description="A schema groups tables, volumes and functions."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create schema</Button>}
          />
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={`Create schema in ${catalog}`}
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
          <Field label="Schema name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="bronze" autoFocus />
          </Field>
          <Field label="Comment">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Raw ingested data" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
