"use client";

import { LayoutDashboard, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, SearchInput, Skeleton, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

function DashboardsInner() {
  const dashboards = useAsync(() => api.dashboards.list(), []);
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

  const rows = (dashboards.data ?? []).filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const dashboard = await api.dashboards.create({
        name: name.trim(),
        datasets: [{ key: "ds1", name: "Dataset 1", sql: "SHOW CATALOGS" }],
        widgets: [
          {
            id: crypto.randomUUID(),
            type: "table",
            title: "Catalogs",
            dataset_key: "ds1",
            x: null,
            y: [],
            group_by: null,
            text: "",
            layout: { w: 12 },
            options: {},
          },
        ],
      });
      toast(`Dashboard “${dashboard.name}” created`, "success");
      router.push(`/dashboards/${dashboard.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create dashboard", "danger");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, dashboardName: string) => {
    if (!confirm(`Delete dashboard “${dashboardName}”?`)) return;
    try {
      await api.dashboards.remove(id);
      toast("Dashboard deleted", "success");
      dashboards.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboards"
        description="Charts driven by SQL datasets that refresh against the lakehouse"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create dashboard
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter dashboards" className="mb-3 max-w-xs" />

        {dashboards.loading && <Skeleton style={{ height: 160 }} />}
        {dashboards.error && <ErrorBanner message={dashboards.error} onRetry={dashboards.reload} />}

        {dashboards.data && dashboards.data.length === 0 && (
          <EmptyState
            icon={<LayoutDashboard size={28} />}
            title="No dashboards yet"
            description="Define SQL datasets, then chart them with bar, line, area, pie, counter and table widgets."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create dashboard</Button>}
          />
        )}

        {dashboards.data && dashboards.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/dashboards/${row.id}`)}
              emptyMessage="No dashboards match the filter."
              columns={[
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                { key: "widgets", header: "Widgets", align: "right", width: 90, render: (row) => row.widgets.length },
                { key: "datasets", header: "Datasets", align: "right", width: 90, render: (row) => row.datasets.length },
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
        title="Create dashboard"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Dashboard name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Order volume overview" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

export default function DashboardsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <DashboardsInner />
    </Suspense>
  );
}
