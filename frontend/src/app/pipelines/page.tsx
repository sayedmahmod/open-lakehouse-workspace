"use client";

import { Play, Plus, Trash2, Waypoints } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import {
  Badge, Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Select, SearchInput,
  Skeleton, Spinner, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration, formatRelative, statusColor } from "@/lib/format";
import { scheduleLabel } from "@/lib/schedule";
import { useAsync } from "@/lib/useAsync";

export default function PipelinesPage() {
  const pipelines = useAsync(() => api.pipelines.list(), []);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", catalog: "", schema: "", dataset: "", sql: "", development: true });
  const [busy, setBusy] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const rows = (pipelines.data ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const pipeline = await api.pipelines.create({
        name: form.name.trim(),
        target_catalog: form.catalog.trim(),
        target_schema: form.schema.trim(),
        development: form.development,
        datasets: form.dataset.trim()
          ? [
              {
                name: form.dataset.trim(),
                type: "materialized_view",
                comment: "",
                sql: form.sql,
                partition_cols: [],
                incremental_key: "",
                expectations: [],
              },
            ]
          : [],
      });
      toast(`Pipeline “${pipeline.name}” created`, "success");
      setCreating(false);
      router.push(`/pipelines/${pipeline.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create pipeline", "danger");
    } finally {
      setBusy(false);
    }
  };

  const start = async (pid: string) => {
    setStartingId(pid);
    try {
      const update = await api.pipelines.start(pid);
      toast(`Update #${update.update_number} started`, "info");
      router.push(`/pipelines/${pid}/updates/${update.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start", "danger");
    } finally {
      setStartingId(null);
    }
  };

  const remove = async (pid: string, name: string) => {
    if (!confirm(`Delete pipeline “${name}” and its update history?`)) return;
    try {
      await api.pipelines.remove(pid);
      toast("Pipeline deleted", "success");
      pipelines.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Pipelines"
        description="Declarative pipelines — materialized views, streaming tables and data-quality expectations, rebuilt in dependency order"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create pipeline
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter pipelines" className="mb-3 max-w-xs" />

        {pipelines.loading && <Skeleton style={{ height: 180 }} />}
        {pipelines.error && <ErrorBanner message={pipelines.error} onRetry={pipelines.reload} />}

        {pipelines.data && pipelines.data.length === 0 && (
          <EmptyState
            icon={<Waypoints size={28} />}
            title="No pipelines yet"
            description="A pipeline is a set of dataset definitions. The engine infers their dependency graph from the SQL and rebuilds them in order, enforcing expectations."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create pipeline</Button>}
          />
        )}

        {pipelines.data && pipelines.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/pipelines/${row.id}`)}
              emptyMessage="No pipelines match the filter."
              columns={[
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                {
                  key: "target",
                  header: "Target",
                  width: 200,
                  render: (row) => (
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {row.target_catalog && row.target_schema ? `${row.target_catalog}.${row.target_schema}` : "— not set —"}
                    </span>
                  ),
                },
                { key: "datasets", header: "Datasets", align: "right", width: 80, render: (row) => row.datasets.length },
                {
                  key: "spark",
                  header: "Recent",
                  width: 100,
                  render: (row) => (
                    <span className="inline-flex items-end gap-[3px]">
                      {(row.recent_statuses ?? []).map((s, i) => (
                        <span key={i} style={{ width: 4, height: 14, borderRadius: 1, background: statusColor(s) }} />
                      ))}
                    </span>
                  ),
                },
                {
                  key: "mode",
                  header: "Mode",
                  width: 110,
                  render: (row) => <Badge tone={row.development ? "info" : "neutral"}>{row.development ? "Development" : "Production"}</Badge>,
                },
                {
                  key: "schedule",
                  header: "Schedule",
                  width: 150,
                  render: (row) => (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {row.continuous ? "Continuous" : row.schedule ? scheduleLabel(row.schedule) : "Manual"}
                    </span>
                  ),
                },
                {
                  key: "last",
                  header: "Last update",
                  width: 150,
                  render: (row) =>
                    row.last_update ? (
                      <span className="flex items-center gap-1.5">
                        <StatusBadge status={row.last_update.status} />
                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {formatRelative(row.last_update.started_at)} · {formatDuration(row.last_update.duration_ms)}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)" }}>Never</span>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  width: 80,
                  render: (row) => (
                    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Start update" disabled={startingId === row.id} onClick={() => start(row.id)}>
                        {startingId === row.id ? <Spinner size={13} /> : <Play size={13} />}
                      </IconButton>
                      <IconButton title="Delete" onClick={() => remove(row.id, row.name)}>
                        <Trash2 size={13} />
                      </IconButton>
                    </span>
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
        title="Create pipeline"
        width={640}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!form.name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Pipeline name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sales medallion" autoFocus />
          </Field>
          <div className="flex gap-2">
            <Field label="Target catalog" className="flex-1">
              <Input className="mono" value={form.catalog} onChange={(e) => setForm({ ...form, catalog: e.target.value })} placeholder="unity" />
            </Field>
            <Field label="Target schema" className="flex-1">
              <Input className="mono" value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} placeholder="gold" />
            </Field>
          </div>
          <Field label="First dataset name">
            <Input className="mono" value={form.dataset} onChange={(e) => setForm({ ...form, dataset: e.target.value })} placeholder="daily_orders" />
          </Field>
          <Field label="Dataset query" hint="Reference other datasets in this pipeline by their name; the graph is inferred from it.">
            <Textarea className="mono" rows={5} value={form.sql} onChange={(e) => setForm({ ...form, sql: e.target.value })} placeholder="SELECT order_date, sum(amount) total FROM unity.silver.orders GROUP BY order_date" />
          </Field>
          <Field label="Mode">
            <Select
              value={form.development ? "dev" : "prod"}
              onChange={(v) => setForm({ ...form, development: v === "dev" })}
              options={[
                { value: "dev", label: "Development — run straight away, fail fast" },
                { value: "prod", label: "Production — validate first, retry failures" },
              ]}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
