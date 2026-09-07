"use client";

import { BarChart3, Database, Pencil, Plus, RefreshCw, Save, Table as TableIcon, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Chart, Counter, ResultTable, type ChartDatum } from "@/components/charts/Chart";
import { Badge, Button, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Select, Skeleton, Spinner, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCell, formatCompact, formatDuration, formatRelative, isNumericType } from "@/lib/format";
import type { Dashboard, DashboardData, DashboardWidget, WidgetType } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

const WIDGET_TYPES: { value: WidgetType; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "bar", label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "area", label: "Area chart" },
  { value: "pie", label: "Pie chart" },
  { value: "counter", label: "Counter" },
  { value: "text", label: "Text" },
];

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const dashboard = useAsync(() => api.dashboards.get(id), [id]);
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editWidget, setEditWidget] = useState<DashboardWidget | null>(null);
  const [editDataset, setEditDataset] = useState<{ key: string; name: string; sql: string } | null>(null);

  useEffect(() => {
    if (dashboard.data) {
      setDraft(structuredClone(dashboard.data));
      api.workspace
        .trackRecent({ kind: "dashboard", object_id: dashboard.data.id, name: dashboard.data.name, href: `/dashboards/${dashboard.data.id}` })
        .catch(() => {});
    }
  }, [dashboard.data]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api.dashboards.refresh(id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Refresh failed", "danger");
    } finally {
      setRefreshing(false);
    }
  }, [id, toast]);

  useEffect(() => {
    if (dashboard.data) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard.data?.id]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.dashboards.update(id, { name: draft.name, description: draft.description, datasets: draft.datasets, widgets: draft.widgets });
      toast("Dashboard saved", "success");
      dashboard.reload();
      setEditing(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    } finally {
      setSaving(false);
    }
  };

  const addWidget = () => {
    setEditWidget({
      id: crypto.randomUUID(),
      type: "bar",
      title: "New widget",
      dataset_key: draft?.datasets[0]?.key ?? null,
      x: null,
      y: [],
      group_by: null,
      text: "",
      layout: { w: 6 },
      options: {},
    });
  };

  const commitWidget = (widget: DashboardWidget) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.widgets.some((w) => w.id === widget.id);
      return { ...prev, widgets: exists ? prev.widgets.map((w) => (w.id === widget.id ? widget : w)) : [...prev.widgets, widget] };
    });
    setEditWidget(null);
  };

  const commitDataset = (dataset: { key: string; name: string; sql: string }) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.datasets.some((d) => d.key === dataset.key);
      return { ...prev, datasets: exists ? prev.datasets.map((d) => (d.key === dataset.key ? dataset : d)) : [...prev.datasets, dataset] };
    });
    setEditDataset(null);
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={draft?.name ?? "Dashboard"}
        breadcrumbs={[{ label: "Dashboards", href: "/dashboards" }, { label: dashboard.data?.name ?? "" }]}
        description={
          data ? `Last refreshed ${formatRelative(data.refreshed_at)}` : dashboard.data?.description || undefined
        }
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
              Refresh
            </Button>
            <Button icon={<Pencil size={14} />} onClick={() => setEditing((v) => !v)} variant={editing ? "primary" : "default"}>
              {editing ? "Done editing" : "Edit"}
            </Button>
            {editing && (
              <Button variant="primary" icon={<Save size={14} />} onClick={save} loading={saving}>
                Save
              </Button>
            )}
          </>
        }
      />

      <div className="px-6">
        {dashboard.loading && <Skeleton style={{ height: 260 }} />}
        {dashboard.error && <ErrorBanner message={dashboard.error} onRetry={dashboard.reload} />}

        {editing && draft && (
          <div className="lh-card mb-4 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Database size={14} style={{ color: "var(--action-icon-default)" }} />
              <span className="font-semibold" style={{ fontSize: 13 }}>
                Datasets
              </span>
              <Button size="sm" icon={<Plus size={12} />} className="ml-auto" onClick={() => setEditDataset({ key: `ds${(draft.datasets.length ?? 0) + 1}`, name: "New dataset", sql: "" })}>
                Add dataset
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {draft.datasets.map((dataset) => (
                <div key={dataset.key} className="flex items-center gap-2 rounded-[4px] px-2 py-1" style={{ background: "var(--bg-secondary)" }}>
                  <Badge>{dataset.key}</Badge>
                  <span style={{ fontSize: 13 }}>{dataset.name}</span>
                  <span className="mono truncate" style={{ fontSize: 11, color: "var(--text-secondary)", maxWidth: 380 }}>
                    {dataset.sql.replace(/\s+/g, " ")}
                  </span>
                  <span className="ml-auto flex gap-0.5">
                    <IconButton title="Edit dataset" onClick={() => setEditDataset({ ...dataset })}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton
                      title="Remove dataset"
                      onClick={() => setDraft({ ...draft, datasets: draft.datasets.filter((d) => d.key !== dataset.key) })}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button icon={<Plus size={14} />} onClick={addWidget}>
                Add widget
              </Button>
            </div>
          </div>
        )}

        {draft && draft.widgets.length === 0 && (
          <EmptyState
            icon={<BarChart3 size={28} />}
            title="No widgets yet"
            description="Add a dataset and a widget to start charting."
            action={<Button variant="primary" onClick={() => setEditing(true)}>Edit dashboard</Button>}
          />
        )}

        <div className="grid grid-cols-12 gap-3">
          {draft?.widgets.map((widget) => (
            <div key={widget.id} className="lh-card overflow-hidden" style={{ gridColumn: `span ${Math.min(12, Math.max(3, widget.layout?.w ?? 6))} / span ${Math.min(12, Math.max(3, widget.layout?.w ?? 6))}` }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="truncate font-semibold" style={{ fontSize: 13 }}>
                  {widget.title}
                </span>
                {editing && (
                  <span className="ml-auto flex gap-0.5">
                    <IconButton title="Edit widget" onClick={() => setEditWidget({ ...widget })}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton title="Remove widget" onClick={() => setDraft({ ...draft, widgets: draft.widgets.filter((w) => w.id !== widget.id) })}>
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                )}
              </div>
              <WidgetBody widget={widget} data={data} loading={refreshing} />
            </div>
          ))}
        </div>
      </div>

      {editWidget && draft && (
        <WidgetEditor
          widget={editWidget}
          datasets={draft.datasets}
          data={data}
          onCancel={() => setEditWidget(null)}
          onSave={commitWidget}
        />
      )}

      {editDataset && (
        <DatasetEditor dataset={editDataset} onCancel={() => setEditDataset(null)} onSave={commitDataset} />
      )}
    </div>
  );
}

function WidgetBody({ widget, data, loading }: { widget: DashboardWidget; data: DashboardData | null; loading: boolean }) {
  if (widget.type === "text") {
    return (
      <div className="p-3" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
        {widget.text || "—"}
      </div>
    );
  }

  const dataset = widget.dataset_key ? data?.data[widget.dataset_key] : undefined;

  if (loading && !dataset) {
    return <div className="p-3"><Skeleton style={{ height: 160 }} /></div>;
  }
  if (!dataset) {
    return (
      <div className="px-3 py-8 text-center" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        No dataset bound. Edit the widget to pick one.
      </div>
    );
  }
  if (dataset.status !== "FINISHED") {
    return (
      <pre className="mono overflow-x-auto whitespace-pre-wrap p-3" style={{ fontSize: 12, margin: 0, background: "var(--bg-danger)" }}>
        {dataset.error}
      </pre>
    );
  }

  const names = dataset.columns.map((c) => c.name);

  if (widget.type === "counter") {
    const column = widget.y[0] ?? names[0];
    const index = names.indexOf(column);
    const value = index >= 0 && dataset.rows[0] ? dataset.rows[0][index] : null;
    return (
      <Counter
        value={typeof value === "number" ? formatCompact(value) : formatCell(value)}
        label={column}
        sublabel={`${dataset.row_count} row${dataset.row_count === 1 ? "" : "s"} · ${formatDuration(dataset.duration_ms)}`}
      />
    );
  }

  if (widget.type === "table") {
    return <ResultTable columns={dataset.columns} rows={dataset.rows} maxHeight={320} />;
  }

  const xIndex = widget.x ? names.indexOf(widget.x) : 0;
  const ySeries = widget.y.length > 0 ? widget.y : names.filter((n, i) => i !== xIndex && isNumericType(dataset.columns[i]?.type)).slice(0, 4);
  const yIndexes = ySeries.map((name) => names.indexOf(name)).filter((i) => i >= 0);

  if (yIndexes.length === 0) {
    return (
      <div className="px-3 py-8 text-center" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        No numeric column to plot. Edit the widget and choose a value column.
      </div>
    );
  }

  const chartData: ChartDatum[] = dataset.rows.slice(0, 200).map((row) => ({
    label: formatCell(xIndex >= 0 ? row[xIndex] : ""),
    values: yIndexes.map((i) => {
      const v = row[i];
      return typeof v === "number" ? v : Number(v);
    }),
  }));

  return (
    <div className="p-2">
      <Chart type={widget.type as "bar" | "line" | "area" | "pie"} data={chartData} seriesNames={yIndexes.map((i) => names[i])} />
    </div>
  );
}

function WidgetEditor({
  widget,
  datasets,
  data,
  onCancel,
  onSave,
}: {
  widget: DashboardWidget;
  datasets: { key: string; name: string; sql: string }[];
  data: DashboardData | null;
  onCancel: () => void;
  onSave: (widget: DashboardWidget) => void;
}) {
  const [draft, setDraft] = useState<DashboardWidget>({ ...widget });
  const columns = useMemo(() => {
    const dataset = draft.dataset_key ? data?.data[draft.dataset_key] : undefined;
    return dataset?.columns ?? [];
  }, [draft.dataset_key, data]);

  return (
    <Modal
      open
      onClose={onCancel}
      title="Widget"
      width={560}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Field label="Type" className="flex-1">
            <Select value={draft.type} onChange={(value) => setDraft({ ...draft, type: value as WidgetType })} options={WIDGET_TYPES} />
          </Field>
          <Field label="Width (of 12)" className="w-40">
            <Select
              value={String(draft.layout?.w ?? 6)}
              onChange={(value) => setDraft({ ...draft, layout: { ...draft.layout, w: Number(value) } })}
              options={[3, 4, 6, 8, 12].map((w) => ({ value: String(w), label: `${w} columns` }))}
            />
          </Field>
        </div>

        {draft.type === "text" ? (
          <Field label="Text">
            <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={5} />
          </Field>
        ) : (
          <>
            <Field label="Dataset">
              <Select
                value={draft.dataset_key ?? ""}
                onChange={(value) => setDraft({ ...draft, dataset_key: value || null })}
                options={[{ value: "", label: "Select a dataset…" }, ...datasets.map((d) => ({ value: d.key, label: `${d.name} (${d.key})` }))]}
              />
            </Field>

            {draft.type !== "table" && columns.length > 0 && (
              <>
                {draft.type !== "counter" && (
                  <Field label="Category column (x axis)">
                    <Select
                      value={draft.x ?? ""}
                      onChange={(value) => setDraft({ ...draft, x: value || null })}
                      options={[{ value: "", label: "First column" }, ...columns.map((c) => ({ value: c.name, label: `${c.name} — ${c.type}` }))]}
                    />
                  </Field>
                )}
                <Field
                  label={draft.type === "counter" ? "Value column" : "Value columns"}
                  hint={draft.type === "counter" ? undefined : "Charts use a single shared axis, so pick measures of comparable scale."}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {columns.map((column) => {
                      const selected = draft.y.includes(column.name);
                      return (
                        <button
                          key={column.name}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              y: draft.type === "counter" ? [column.name] : selected ? draft.y.filter((y) => y !== column.name) : [...draft.y, column.name],
                            })
                          }
                          className="rounded-[4px] px-1.5 py-0.5"
                          style={{
                            fontSize: 12,
                            border: `1px solid ${selected ? "var(--action-primary-bg)" : "var(--border-strong)"}`,
                            background: selected ? "var(--bg-info)" : "transparent",
                            color: selected ? "var(--link)" : "var(--text-secondary)",
                          }}
                        >
                          {column.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </>
            )}
            {draft.type !== "table" && columns.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Refresh the dashboard once so the dataset’s columns are known, then pick the axes here.
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function DatasetEditor({
  dataset,
  onCancel,
  onSave,
}: {
  dataset: { key: string; name: string; sql: string };
  onCancel: () => void;
  onSave: (dataset: { key: string; name: string; sql: string }) => void;
}) {
  const [draft, setDraft] = useState({ ...dataset });
  return (
    <Modal
      open
      onClose={onCancel}
      title="Dataset"
      width={640}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(draft)} disabled={!draft.sql.trim()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Field label="Key" className="w-32" hint="Referenced by widgets">
            <Input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
          </Field>
          <Field label="Name" className="flex-1">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
        </div>
        <Field label="SQL" required>
          <Textarea value={draft.sql} onChange={(e) => setDraft({ ...draft, sql: e.target.value })} rows={8} className="mono" placeholder="SELECT status, COUNT(*) AS n FROM unity.gold.orders GROUP BY status" />
        </Field>
      </div>
    </Modal>
  );
}
