"use client";

import { BellRing, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, SearchInput, Select, Skeleton, Spinner, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { scheduleLabel } from "@/lib/schedule";
import { useAsync } from "@/lib/useAsync";

function alertTone(state: string) {
  return state === "triggered" ? "danger" : state === "ok" ? "success" : state === "error" ? "warning" : "neutral";
}

function AlertsInner() {
  const alerts = useAsync(() => api.alerts.list(), []);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", sql: "", column_name: "", operator: ">", threshold: "0" });
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const rows = (alerts.data ?? []).filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  const create = async () => {
    if (!form.name.trim() || !form.sql.trim()) return;
    setBusy(true);
    try {
      const alert = await api.alerts.create({ ...form, name: form.name.trim(), paused: true });
      toast(`Alert “${alert.name}” created`, "success");
      setCreating(false);
      setForm({ name: "", sql: "", column_name: "", operator: ">", threshold: "0" });
      alerts.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create alert", "danger");
    } finally {
      setBusy(false);
    }
  };

  const evaluate = async (id: string) => {
    setChecking(id);
    try {
      const result = await api.alerts.evaluate(id);
      toast(`Alert state: ${result.state}${result.value !== undefined ? ` (value ${result.value})` : ""}`, result.state === "triggered" ? "danger" : "success");
      alerts.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Evaluation failed", "danger");
    } finally {
      setChecking(null);
    }
  };

  const togglePause = async (id: string, paused: boolean) => {
    try {
      await api.alerts.update(id, { paused: !paused });
      alerts.reload();
    } catch {
      toast("Could not update", "danger");
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete alert “${name}”?`)) return;
    try {
      await api.alerts.remove(id);
      toast("Alert deleted", "success");
      alerts.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Alerts"
        description="A query, a column and a threshold — evaluated on a schedule"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create alert
          </Button>
        }
      />

      <div className="px-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter alerts" className="mb-3 max-w-xs" />

        {alerts.loading && <Skeleton style={{ height: 160 }} />}
        {alerts.error && <ErrorBanner message={alerts.error} onRetry={alerts.reload} />}

        {alerts.data && alerts.data.length === 0 && (
          <EmptyState
            icon={<BellRing size={28} />}
            title="No alerts yet"
            description="Watch a metric — row counts, freshness, error rates — and get a state you can see at a glance."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create alert</Button>}
          />
        )}

        {alerts.data && alerts.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/alerts/${row.id}`)}
              emptyMessage="No alerts match the filter."
              columns={[
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                {
                  key: "state",
                  header: "State",
                  width: 110,
                  render: (row) => <Badge tone={alertTone(row.state)}>{row.state}</Badge>,
                },
                {
                  key: "condition",
                  header: "Condition",
                  width: 200,
                  render: (row) => (
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {row.column_name || "first column"} {row.operator} {row.threshold}
                    </span>
                  ),
                },
                { key: "value", header: "Last value", width: 120, render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.last_value ?? "—"}</span> },
                { key: "schedule", header: "Schedule", width: 160, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{scheduleLabel(row.schedule)}</span> },
                { key: "checked", header: "Checked", width: 140, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.last_checked_at ? formatRelative(row.last_checked_at) : "never"}</span> },
                {
                  key: "actions",
                  header: "",
                  width: 110,
                  render: (row) => (
                    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Evaluate now" disabled={checking === row.id} onClick={() => evaluate(row.id)}>
                        {checking === row.id ? <Spinner size={13} /> : <Play size={13} />}
                      </IconButton>
                      <IconButton title={row.paused ? "Resume" : "Pause"} disabled={!row.schedule} onClick={() => togglePause(row.id, row.paused)}>
                        {row.paused ? <Play size={13} /> : <Pause size={13} />}
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
        title="Create alert"
        width={620}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!form.name.trim() || !form.sql.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Alert name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Orders stopped arriving" autoFocus />
          </Field>
          <Field label="Query" required hint="The first row of the result is evaluated.">
            <Textarea value={form.sql} onChange={(e) => setForm({ ...form, sql: e.target.value })} rows={5} className="mono" placeholder="SELECT COUNT(*) AS n FROM unity.bronze.orders WHERE ingested_at > current_date()" />
          </Field>
          <div className="flex gap-2">
            <Field label="Column" className="flex-1" hint="Blank uses the first column">
              <Input value={form.column_name} onChange={(e) => setForm({ ...form, column_name: e.target.value })} placeholder="n" />
            </Field>
            <Field label="Operator" className="w-28">
              <Select
                value={form.operator}
                onChange={(value) => setForm({ ...form, operator: value })}
                options={[">", ">=", "<", "<=", "==", "!="].map((op) => ({ value: op, label: op }))}
              />
            </Field>
            <Field label="Threshold" className="w-32">
              <Input value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <AlertsInner />
    </Suspense>
  );
}
