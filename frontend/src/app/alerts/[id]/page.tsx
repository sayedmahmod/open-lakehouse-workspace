"use client";

import { Play, Save } from "lucide-react";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, ErrorBanner, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { scheduleLabel } from "@/lib/schedule";
import type { Alert, Schedule } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const alert = useAsync(() => api.alerts.get(id), [id]);
  const events = useAsync(() => api.alerts.events(id, 50), [id]);
  const [draft, setDraft] = useState<Alert | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (alert.data) setDraft(structuredClone(alert.data));
  }, [alert.data]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.alerts.update(id, {
        name: draft.name,
        sql: draft.sql,
        column_name: draft.column_name,
        operator: draft.operator,
        threshold: draft.threshold,
        schedule: draft.schedule ?? undefined,
        paused: draft.paused,
      });
      toast("Alert saved", "success");
      alert.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    } finally {
      setSaving(false);
    }
  };

  const evaluate = async () => {
    setChecking(true);
    try {
      const result = await api.alerts.evaluate(id);
      toast(`State: ${result.state}`, result.state === "triggered" ? "danger" : "success");
      alert.reload();
      events.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Evaluation failed", "danger");
    } finally {
      setChecking(false);
    }
  };

  const setSchedule = (schedule: Schedule | null) => setDraft((prev) => (prev ? { ...prev, schedule } : prev));

  return (
    <div className="pb-10">
      <PageHeader
        title={alert.data?.name ?? "Alert"}
        breadcrumbs={[{ label: "Alerts", href: "/alerts" }, { label: alert.data?.name ?? "" }]}
        description={
          alert.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={alert.data.state === "triggered" ? "danger" : alert.data.state === "ok" ? "success" : "neutral"}>{alert.data.state}</Badge>
              <span>{scheduleLabel(alert.data.schedule)}</span>
              {alert.data.last_checked_at && <span>· checked {formatRelative(alert.data.last_checked_at)}</span>}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon={<Save size={14} />} onClick={save} loading={saving}>
              Save
            </Button>
            <Button variant="primary" icon={<Play size={14} />} onClick={evaluate} loading={checking}>
              Evaluate now
            </Button>
          </>
        }
      />

      <div className="px-6">
        {alert.loading && <Skeleton style={{ height: 200 }} />}
        {alert.error && <ErrorBanner message={alert.error} onRetry={alert.reload} />}

        {draft && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lh-card p-4">
              <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
                Definition
              </h2>
              <div className="flex flex-col gap-3">
                <Field label="Name">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
                <Field label="Query">
                  <Textarea value={draft.sql} onChange={(e) => setDraft({ ...draft, sql: e.target.value })} rows={6} className="mono" />
                </Field>
                <div className="flex gap-2">
                  <Field label="Column" className="flex-1">
                    <Input value={draft.column_name} onChange={(e) => setDraft({ ...draft, column_name: e.target.value })} />
                  </Field>
                  <Field label="Operator" className="w-24">
                    <Select value={draft.operator} onChange={(value) => setDraft({ ...draft, operator: value })} options={[">", ">=", "<", "<=", "==", "!="].map((op) => ({ value: op, label: op }))} />
                  </Field>
                  <Field label="Threshold" className="w-28">
                    <Input value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} />
                  </Field>
                </div>
                <Field label="Schedule">
                  <Select
                    value={draft.schedule?.kind ?? "none"}
                    onChange={(value) => {
                      if (value === "none") setSchedule(null);
                      else if (value === "interval") setSchedule({ kind: "interval", every: 15, unit: "minutes" });
                      else setSchedule({ kind: "daily", at: "03:00" });
                    }}
                    options={[
                      { value: "none", label: "Manual only" },
                      { value: "interval", label: "Every N minutes / hours" },
                      { value: "daily", label: "Daily" },
                    ]}
                  />
                </Field>
                {draft.schedule?.kind === "interval" && (
                  <div className="flex gap-2">
                    <Field label="Every" className="w-28">
                      <Input type="number" min={1} value={draft.schedule.every ?? 15} onChange={(e) => setSchedule({ ...draft.schedule!, every: Number(e.target.value) })} />
                    </Field>
                    <Field label="Unit" className="w-36">
                      <Select value={draft.schedule.unit ?? "minutes"} onChange={(value) => setSchedule({ ...draft.schedule!, unit: value as "minutes" | "hours" })} options={[{ value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }]} />
                    </Field>
                  </div>
                )}
                {draft.schedule?.kind === "daily" && (
                  <Field label="Time (UTC)" className="w-40">
                    <Input type="time" value={draft.schedule.at ?? "03:00"} onChange={(e) => setSchedule({ ...draft.schedule!, at: e.target.value })} />
                  </Field>
                )}
                <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={!draft.paused} disabled={!draft.schedule} onChange={(e) => setDraft({ ...draft, paused: !e.target.checked })} />
                  Schedule active
                </label>
              </div>
            </div>

            <div className="lh-card overflow-hidden">
              <div className="px-3 py-2 font-semibold" style={{ fontSize: 13, borderBottom: "1px solid var(--border)" }}>
                Evaluation history
              </div>
              <DataTable
                dense
                rows={events.data ?? []}
                keyOf={(row) => row.id}
                emptyMessage="Not evaluated yet."
                columns={[
                  {
                    key: "state",
                    header: "State",
                    width: 110,
                    render: (row) => <Badge tone={row.state === "triggered" ? "danger" : row.state === "ok" ? "success" : "warning"}>{row.state}</Badge>,
                  },
                  { key: "value", header: "Value", width: 110, render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.value ?? "—"}</span> },
                  { key: "when", header: "Checked", render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.checked_at)}</span> },
                  { key: "error", header: "Error", render: (row) => <span style={{ fontSize: 12, color: "var(--text-danger)" }}>{row.error ?? ""}</span> },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
