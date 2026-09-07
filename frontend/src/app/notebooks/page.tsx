"use client";

import { NotebookText, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, SearchInput, Skeleton, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

function NotebooksInner() {
  const notebooks = useAsync(() => api.notebooks.list(), []);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const rows = (notebooks.data ?? []).filter((n) => n.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const notebook = await api.notebooks.create({
        name: name.trim(),
        cells: [{ id: crypto.randomUUID(), language: "sql", source: "SHOW CATALOGS" }],
      });
      toast(`Notebook “${notebook.name}” created`, "success");
      router.push(`/notebooks/${notebook.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create notebook", "danger");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, notebookName: string) => {
    if (!confirm(`Delete notebook “${notebookName}”?`)) return;
    try {
      await api.notebooks.remove(id);
      toast("Notebook deleted", "success");
      notebooks.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Notebooks"
        description="Ordered SQL cells executed against Spark Connect"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create notebook
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter notebooks" className="mb-3 max-w-xs" />

        {notebooks.loading && <Skeleton style={{ height: 160 }} />}
        {notebooks.error && <ErrorBanner message={notebooks.error} onRetry={notebooks.reload} />}

        {notebooks.data && notebooks.data.length === 0 && (
          <EmptyState
            icon={<NotebookText size={28} />}
            title="No notebooks yet"
            description="A notebook keeps a sequence of SQL cells you can run individually or top to bottom."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create notebook</Button>}
          />
        )}

        {notebooks.data && notebooks.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/notebooks/${row.id}`)}
              emptyMessage="No notebooks match the filter."
              columns={[
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                { key: "cells", header: "Cells", align: "right", width: 80, render: (row) => row.cells.length },
                { key: "updated", header: "Updated", width: 160, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.updated_at)}</span> },
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

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create notebook"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Notebook name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Medallion exploration" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

export default function NotebooksPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <NotebooksInner />
    </Suspense>
  );
}
