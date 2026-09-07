"use client";

import { ChevronDown, Play, Plus, RefreshCw, Save, Square, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { Dag } from "@/components/Dag";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Badge, Button, DataTable, Dropdown, ErrorBanner, Field, IconButton, Input, Select, Skeleton, StatusBadge,
  Tabs, Textarea, useToast,
} from "@/components/ui";
import { NODE_H, NODE_W } from "@/lib/dag";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, formatNumber, statusColor } from "@/lib/format";
import { CRON_PRESETS, scheduleLabel } from "@/lib/schedule";
import type { Expectation, Pipeline, PipelineDataset, Schedule } from "@/lib/types";
import { useAsync, useInterval } from "@/lib/useAsync";

const DATASET_TYPES = [
  { value: "materialized_view", label: "Materialized view" },
  { value: "streaming_table", label: "Streaming table" },
  { value: "view", label: "View (temporary)" },
];

function blankDataset(name: string): PipelineDataset {
  return { name, type: "materialized_view", comment: "", sql: "", partition_cols: [], incremental_key: "", expectations: [] };
}

export default function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const pipeline = useAsync(() => api.pipelines.get(id), [id]);
  const graph = useAsync(() => api.pipelines.graph(id), [id]);
  const updates = useAsync(() => api.pipelines.updates(id, 40), [id]);

  const [tab, setTab] = useState("graph");
  const [draft, setDraft] = useState<Pipeline | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (pipeline.data) setDraft(structuredClone(pipeline.data));
  }, [pipeline.data]);

  const activeUpdate = (updates.data ?? []).find((u) => u.status === "RUNNING" || u.status === "QUEUED");
  useInterval(() => {
    if (activeUpdate) {
      updates.reload();
      graph.reload();
    }
  }, 2500);

  const dirty = useMemo(
    () => draft && pipeline.data && JSON.stringify(draft) !== JSON.stringify(pipeline.data),
    [draft, pipeline.data],
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.pipelines.update(id, {
        name: draft.name,
        description: draft.description,
        target_catalog: draft.target_catalog,
        target_schema: draft.target_schema,
        datasets: draft.datasets,
        configuration: draft.configuration,
        development: draft.development,
        continuous: draft.continuous,
        schedule: draft.schedule ?? undefined,
        paused: draft.paused,
        notifications: draft.notifications,
        tags: draft.tags,
      });
      toast("Pipeline saved", "success");
      pipeline.reload();
      graph.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    } finally {
      setSaving(false);
    }
  };

  const start = async (body: { full_refresh?: boolean; refresh_selection?: string[] } = {}) => {
    setStarting(true);
    try {
      const update = await api.pipelines.start(id, body);
      toast(`Update #${update.update_number} started`, "info");
      router.push(`/pipelines/${id}/updates/${update.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start", "danger");
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!activeUpdate) return;
    try {
      await api.pipelines.stopUpdate(activeUpdate.id);
      toast("Stopping update…", "info");
      updates.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not stop", "danger");
    }
  };

  const patchDataset = (name: string, patch: Partial<PipelineDataset>) =>
    setDraft((p) => (p ? { ...p, datasets: p.datasets.map((d) => (d.name === name ? { ...d, ...patch } : d)) } : p));

  return (
    <div className="pb-10">
      <PageHeader
        title={pipeline.data?.name ?? "Pipeline"}
        breadcrumbs={[{ label: "Pipelines", href: "/pipelines" }, { label: pipeline.data?.name ?? "" }]}
        description={
          pipeline.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={pipeline.data.development ? "info" : "neutral"}>{pipeline.data.development ? "Development" : "Production"}</Badge>
              <span className="mono">{pipeline.data.target_catalog}.{pipeline.data.target_schema}</span>
              <span>· {pipeline.data.continuous ? "Continuous" : scheduleLabel(pipeline.data.schedule)}</span>
              {activeUpdate && <Badge tone="info">update running</Badge>}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon={<Save size={14} />} onClick={save} loading={saving} disabled={!dirty}>Save</Button>
            {activeUpdate ? (
              <Button variant="danger" icon={<Square size={14} />} onClick={stop}>Stop</Button>
            ) : (
              <Dropdown
                align="right"
                trigger={
                  <Button variant="primary" icon={<Play size={14} />} loading={starting}>
                    Start <ChevronDown size={13} />
                  </Button>
                }
                items={[
                  { label: "Refresh all", onClick: () => start() },
                  { label: "Full refresh all", onClick: () => start({ full_refresh: true }) },
                  ...(selected
                    ? [{ label: `Refresh “${selected}” + upstreams`, onClick: () => start({ refresh_selection: [selected] }) }]
                    : []),
                ]}
              />
            )}
          </>
        }
      />

      <div className="px-6">
        <Tabs
          active={tab}
          onChange={setTab}
          className="mb-4"
          tabs={[
            { id: "graph", label: "Graph" },
            { id: "datasets", label: "Datasets", count: draft?.datasets.length },
            { id: "updates", label: "Updates", count: updates.data?.length },
            { id: "settings", label: "Settings" },
          ]}
        />

        {pipeline.loading && <Skeleton style={{ height: 260 }} />}
        {pipeline.error && <ErrorBanner message={pipeline.error} onRetry={pipeline.reload} />}

        {tab === "graph" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Node colour = last update status · click a node to scope a refresh
              </span>
              <IconButton title="Refresh" onClick={() => graph.reload()}><RefreshCw size={13} /></IconButton>
            </div>
            {graph.data && (
              <Dag
                nodes={graph.data.nodes.map((n) => ({ id: n.name, node: n }))}
                edges={graph.data.edges}
                selectedId={selected}
                onSelect={setSelected}
                height={460}
                nodeBox={() => ({ w: NODE_W, h: NODE_H + 8 })}
                emptyLabel="Add datasets to see the graph"
                renderNode={(n, { selected: sel }) => {
                  const d = n.node;
                  const q = d.quality;
                  return (
                    <div
                      className="flex h-full w-full flex-col overflow-hidden rounded-[6px]"
                      style={{
                        background: "var(--bg-primary)",
                        border: `1.5px solid ${sel ? "var(--action-primary-bg)" : "var(--border-strong)"}`,
                        boxShadow: sel ? "0 0 0 3px var(--action-default-bg-hover)" : "var(--shadow-sm)",
                      }}
                    >
                      <div style={{ height: 4, background: d.status ? statusColor(d.status) : "var(--border-strong)" }} />
                      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                        <span className="truncate font-semibold" style={{ fontSize: 13 }}>{d.name}</span>
                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {DATASET_TYPES.find((t) => t.value === d.type)?.label ?? d.type}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {d.rows != null ? `${formatNumber(d.rows)} rows` : "not built"}
                          {d.duration_ms != null && ` · ${formatDuration(d.duration_ms)}`}
                        </span>
                        {d.expectation_count > 0 && (
                          <span style={{ fontSize: 11, color: q && q.failed > 0 ? "var(--text-warning)" : "var(--text-success)" }}>
                            {q ? `${formatNumber(q.total - q.failed)}/${formatNumber(q.total)} pass` : `${d.expectation_count} expectations`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            )}
          </div>
        )}

        {tab === "datasets" && draft && (
          <DatasetsTab
            datasets={draft.datasets}
            onPatch={patchDataset}
            onAdd={() => {
              let n = draft.datasets.length + 1;
              while (draft.datasets.some((d) => d.name === `dataset_${n}`)) n++;
              setDraft({ ...draft, datasets: [...draft.datasets, blankDataset(`dataset_${n}`)] });
            }}
            onRemove={(name) => setDraft({ ...draft, datasets: draft.datasets.filter((d) => d.name !== name) })}
            onRename={(oldName, newName) => {
              const clean = newName.trim().replace(/[^\w]/g, "_");
              if (!clean || draft.datasets.some((d) => d.name === clean)) return;
              setDraft({ ...draft, datasets: draft.datasets.map((d) => (d.name === oldName ? { ...d, name: clean } : d)) });
            }}
            onSave={save}
            saving={saving}
          />
        )}

        {tab === "updates" && (
          <div className="lh-card overflow-hidden">
            {updates.data && (
              <DataTable
                dense
                rows={updates.data}
                keyOf={(r) => r.id}
                onRowClick={(r) => router.push(`/pipelines/${id}/updates/${r.id}`)}
                emptyMessage="No updates yet."
                columns={[
                  { key: "n", header: "Update", width: 90, render: (r) => <span className="mono font-medium">#{r.update_number}</span> },
                  { key: "status", header: "Status", width: 120, render: (r) => <StatusBadge status={r.status} /> },
                  { key: "cause", header: "Cause", width: 110, render: (r) => <Badge>{r.cause}</Badge> },
                  { key: "refresh", header: "Kind", width: 140, render: (r) => (
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {r.full_refresh ? "Full refresh" : "Incremental"}{r.refresh_selection.length ? ` · ${r.refresh_selection.length} selected` : ""}
                    </span>
                  ) },
                  { key: "datasets", header: "Datasets", render: (r) => (
                    <span className="flex flex-wrap gap-1">
                      {r.datasets.map((d) => (
                        <span key={d.name} title={`${d.name}: ${d.status}`} style={{ width: 8, height: 8, borderRadius: 2, background: statusColor(d.status) }} />
                      ))}
                    </span>
                  ) },
                  { key: "duration", header: "Duration", align: "right", width: 100, render: (r) => formatDuration(r.duration_ms) },
                  { key: "started", header: "Started", width: 170, render: (r) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(r.started_at)}</span> },
                ]}
              />
            )}
          </div>
        )}

        {tab === "settings" && draft && (
          <SettingsTab
            draft={draft}
            onChange={(patch) => setDraft((p) => (p ? { ...p, ...patch } : p))}
            onSave={save}
            saving={saving}
            onDelete={async () => {
              if (!confirm(`Delete pipeline “${draft.name}”?`)) return;
              await api.pipelines.remove(id);
              toast("Pipeline deleted", "success");
              router.push("/pipelines");
            }}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- datasets */

function DatasetsTab({
  datasets,
  onPatch,
  onAdd,
  onRemove,
  onRename,
  onSave,
  saving,
}: {
  datasets: PipelineDataset[];
  onPatch: (name: string, patch: Partial<PipelineDataset>) => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {datasets.map((d) => (
        <DatasetCard key={d.name} d={d} onPatch={(p) => onPatch(d.name, p)} onRemove={() => onRemove(d.name)} onRename={(n) => onRename(d.name, n)} />
      ))}
      <div className="flex gap-2">
        <Button icon={<Plus size={14} />} onClick={onAdd}>Add dataset</Button>
        <Button variant="primary" icon={<Save size={14} />} onClick={onSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

function DatasetCard({
  d,
  onPatch,
  onRemove,
  onRename,
}: {
  d: PipelineDataset;
  onPatch: (patch: Partial<PipelineDataset>) => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState(d.name);
  useEffect(() => setNameDraft(d.name), [d.name]);

  const setExp = (i: number, patch: Partial<Expectation>) =>
    onPatch({ expectations: d.expectations.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <div className="lh-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Field label="Name" className="w-56">
          <Input className="mono" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => nameDraft !== d.name && onRename(nameDraft)} />
        </Field>
        <Field label="Type" className="w-52">
          <Select value={d.type} onChange={(v) => onPatch({ type: v as PipelineDataset["type"] })} options={DATASET_TYPES} />
        </Field>
        {d.type === "streaming_table" && (
          <Field label="Incremental key" className="w-44">
            <Input className="mono" value={d.incremental_key} onChange={(e) => onPatch({ incremental_key: e.target.value })} placeholder="event_time" />
          </Field>
        )}
        <Field label="Partition by (comma sep.)" className="w-52">
          <Input className="mono" value={d.partition_cols.join(", ")} onChange={(e) => onPatch({ partition_cols: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} />
        </Field>
        <span className="ml-auto pt-5">
          <IconButton title="Remove dataset" onClick={onRemove}><Trash2 size={14} /></IconButton>
        </span>
      </div>

      <Field label="Comment">
        <Input value={d.comment} onChange={(e) => onPatch({ comment: e.target.value })} />
      </Field>

      <Field label="Query" className="mt-2" hint="Use ${config_key} for pipeline configuration values; reference sibling datasets by name.">
        <Textarea className="mono" rows={6} value={d.sql} onChange={(e) => onPatch({ sql: e.target.value })} />
      </Field>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-medium" style={{ fontSize: 13 }}>Expectations</span>
          <IconButton title="Add expectation" onClick={() => onPatch({ expectations: [...d.expectations, { name: `expect_${d.expectations.length + 1}`, condition: "", action: "warn" }] })}>
            <Plus size={13} />
          </IconButton>
        </div>
        {d.expectations.map((e, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <Input className="mono w-40" value={e.name} onChange={(ev) => setExp(i, { name: ev.target.value })} placeholder="name" />
            <Input className="mono flex-1" value={e.condition} onChange={(ev) => setExp(i, { condition: ev.target.value })} placeholder="amount > 0" />
            <Select
              className="w-28"
              value={e.action}
              onChange={(v) => setExp(i, { action: v as Expectation["action"] })}
              options={[
                { value: "warn", label: "Warn" },
                { value: "drop", label: "Drop row" },
                { value: "fail", label: "Fail" },
              ]}
            />
            <IconButton title="Remove" onClick={() => onPatch({ expectations: d.expectations.filter((_, j) => j !== i) })}><Trash2 size={13} /></IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- settings */

function SettingsTab({
  draft,
  onChange,
  onSave,
  saving,
  onDelete,
}: {
  draft: Pipeline;
  onChange: (patch: Partial<Pipeline>) => void;
  onSave: () => void;
  saving: boolean;
  onDelete: () => void;
}) {
  const s = draft.schedule;
  const kind = draft.continuous ? "continuous" : s?.kind ?? "none";
  const setSchedule = (schedule: Schedule | null) => onChange({ schedule, continuous: false });
  const config = Object.entries(draft.configuration);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="lh-card flex flex-col gap-3 p-4">
        <Field label="Description">
          <Textarea rows={2} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Field label="Target catalog" className="flex-1">
            <Input className="mono" value={draft.target_catalog} onChange={(e) => onChange({ target_catalog: e.target.value })} />
          </Field>
          <Field label="Target schema" className="flex-1">
            <Input className="mono" value={draft.target_schema} onChange={(e) => onChange({ target_schema: e.target.value })} />
          </Field>
        </div>
        <Field label="Mode">
          <Select
            value={draft.development ? "dev" : "prod"}
            onChange={(v) => onChange({ development: v === "dev" })}
            options={[
              { value: "dev", label: "Development — run straight away, fail fast" },
              { value: "prod", label: "Production — validate every query first, retry a failed dataset twice" },
            ]}
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-medium" style={{ fontSize: 13 }}>Configuration</span>
            <IconButton title="Add key" onClick={() => onChange({ configuration: { ...draft.configuration, [`key_${config.length + 1}`]: "" } })}>
              <Plus size={13} />
            </IconButton>
          </div>
          {config.map(([k, v]) => (
            <div key={k} className="mb-1.5 flex items-center gap-2">
              <Input className="mono w-48" defaultValue={k} onBlur={(e) => {
                const nk = e.target.value.trim();
                if (!nk || nk === k) return;
                const next = { ...draft.configuration };
                delete next[k];
                next[nk] = v;
                onChange({ configuration: next });
              }} />
              <Input className="mono flex-1" value={v} onChange={(e) => onChange({ configuration: { ...draft.configuration, [k]: e.target.value } })} />
              <IconButton title="Remove" onClick={() => {
                const next = { ...draft.configuration };
                delete next[k];
                onChange({ configuration: next });
              }}><Trash2 size={13} /></IconButton>
            </div>
          ))}
        </div>
      </div>

      <div className="lh-card flex flex-col gap-3 p-4">
        <Field label="Trigger">
          <Select
            value={kind}
            onChange={(v) => {
              if (v === "none") setSchedule(null);
              else if (v === "continuous") onChange({ continuous: true, schedule: null, paused: false });
              else if (v === "interval") setSchedule({ kind: "interval", every: 1, unit: "hours" });
              else if (v === "daily") setSchedule({ kind: "daily", at: "02:00" });
              else setSchedule({ kind: "cron", cron: "0 * * * *", tz: "UTC" });
            }}
            options={[
              { value: "none", label: "Manual only" },
              { value: "interval", label: "Every N minutes / hours" },
              { value: "daily", label: "Daily at a fixed time" },
              { value: "cron", label: "Cron expression" },
              { value: "continuous", label: "Continuous" },
            ]}
          />
        </Field>
        {s?.kind === "interval" && (
          <div className="flex gap-2">
            <Field label="Every" className="w-28"><Input type="number" min={1} value={s.every ?? 1} onChange={(e) => setSchedule({ ...s, every: Number(e.target.value) })} /></Field>
            <Field label="Unit" className="w-40">
              <Select value={s.unit ?? "hours"} onChange={(v) => setSchedule({ ...s, unit: v as "minutes" | "hours" })} options={[{ value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }]} />
            </Field>
          </div>
        )}
        {s?.kind === "daily" && (
          <Field label="Time (UTC)" className="w-40"><Input type="time" value={s.at ?? "02:00"} onChange={(e) => setSchedule({ ...s, at: e.target.value })} /></Field>
        )}
        {s?.kind === "cron" && (
          <div className="flex flex-col gap-2">
            <Field label="Preset">
              <Select value={s.cron ?? ""} onChange={(v) => setSchedule({ ...s, cron: v })} options={[{ value: s.cron ?? "", label: "Custom…" }, ...CRON_PRESETS.map((p) => ({ value: p.value, label: p.label }))]} />
            </Field>
            <div className="flex gap-2">
              <Field label="Expression" className="flex-1"><Input className="mono" value={s.cron ?? ""} onChange={(e) => setSchedule({ ...s, cron: e.target.value })} /></Field>
              <Field label="Timezone" className="w-48"><Input value={s.tz ?? "UTC"} onChange={(e) => setSchedule({ ...s, tz: e.target.value })} /></Field>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{scheduleLabel(s)}</span>
          </div>
        )}
        {kind !== "none" && kind !== "continuous" && (
          <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={!draft.paused} onChange={(e) => onChange({ paused: !e.target.checked })} />
            Schedule active
          </label>
        )}

        <Field label="On update success (webhooks)">
          {(draft.notifications.on_update_success ?? []).map((u, i) => (
            <div key={i} className="mb-1.5 flex gap-2">
              <Input className="mono flex-1" value={u} onChange={(e) => onChange({ notifications: { ...draft.notifications, on_update_success: draft.notifications.on_update_success.map((x, j) => (j === i ? e.target.value : x)) } })} />
              <IconButton title="Remove" onClick={() => onChange({ notifications: { ...draft.notifications, on_update_success: draft.notifications.on_update_success.filter((_, j) => j !== i) } })}><Trash2 size={13} /></IconButton>
            </div>
          ))}
          <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange({ notifications: { ...draft.notifications, on_update_success: [...draft.notifications.on_update_success, ""] } })}>Add</Button>
        </Field>
        <Field label="On update failure (webhooks)">
          {(draft.notifications.on_update_failure ?? []).map((u, i) => (
            <div key={i} className="mb-1.5 flex gap-2">
              <Input className="mono flex-1" value={u} onChange={(e) => onChange({ notifications: { ...draft.notifications, on_update_failure: draft.notifications.on_update_failure.map((x, j) => (j === i ? e.target.value : x)) } })} />
              <IconButton title="Remove" onClick={() => onChange({ notifications: { ...draft.notifications, on_update_failure: draft.notifications.on_update_failure.filter((_, j) => j !== i) } })}><Trash2 size={13} /></IconButton>
            </div>
          ))}
          <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange({ notifications: { ...draft.notifications, on_update_failure: [...draft.notifications.on_update_failure, ""] } })}>Add</Button>
        </Field>

        <div><Button variant="primary" onClick={onSave} loading={saving}>Save</Button></div>
      </div>

      <div className="lh-card p-4" style={{ borderColor: "var(--border-danger)" }}>
        <div className="mb-2 font-medium" style={{ fontSize: 13, color: "var(--text-danger)" }}>Danger zone</div>
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={onDelete}>Delete pipeline</Button>
      </div>
    </div>
  );
}
