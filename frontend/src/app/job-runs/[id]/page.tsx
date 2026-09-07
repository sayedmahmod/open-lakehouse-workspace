"use client";

import {
  Ban,
  ChevronRight,
  Folder,
  GitFork,
  Network,
  RefreshCw,
  Rows3,
  Server,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Dag } from "@/components/Dag";
import {
  ARMS_H,
  CARD_W,
  ConditionArms,
  FOR_EACH_PAD,
  ForEachFrame,
  NodeCard,
  NodeRow,
  NodeTitle,
  RUN_IF_LABEL,
  RUN_IF_PAD,
  RunIfCaption,
  StatusGlyph,
  cardHeight,
  conditionPorts,
  taskTypeMeta,
} from "@/components/jobs/graph";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Badge,
  Button,
  DataTable,
  ErrorBanner,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, formatNumber, statusColor, statusLabel } from "@/lib/format";
import type { JobRun, TaskRun } from "@/lib/types";
import { useAsync, useInterval } from "@/lib/useAsync";

const REPAIRABLE = new Set(["FAILED", "TIMED_OUT", "UPSTREAM_FAILED", "SKIPPED", "CANCELED"]);

/** Graph / Timeline / List — the three ways to read a run. */
const VIEWS = [
  { value: "graph", label: <span className="flex items-center gap-1.5"><Network size={13} />Graph</span>, title: "Graph" },
  { value: "timeline", label: <span className="flex items-center gap-1.5"><GitFork size={13} />Timeline</span>, title: "Timeline" },
  { value: "list", label: <span className="flex items-center gap-1.5"><Rows3 size={13} />List</span>, title: "List" },
];

export default function JobRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const run = useAsync(() => api.jobs.runDetail(id), [id]);
  const [view, setView] = useState("graph");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useInterval(() => {
    if (run.data && (run.data.status === "RUNNING" || run.data.status === "QUEUED")) run.reload();
  }, 2000);

  const data = run.data;
  const active = data?.status === "RUNNING" || data?.status === "QUEUED";
  const canRepair = !!data && !active && data.task_runs.some((t) => REPAIRABLE.has(t.status));
  const selected = data?.task_runs.find((t) => t.key === selectedKey) ?? null;

  const repair = async () => {
    setBusy(true);
    try {
      await api.jobs.repair(id);
      toast("Repair started", "info");
      run.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Repair failed", "danger");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await api.jobs.cancelRun(id);
      toast("Canceling run…", "info");
      run.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Cancel failed", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={data ? `${data.job_name} · run #${data.run_number}` : "Run"}
        breadcrumbs={[
          { label: "Job Runs", href: "/job-runs" },
          ...(data ? [{ label: data.job_name ?? "", href: `/jobs/${data.job_id}` }] : []),
        ]}
        description={
          data ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.status} />
              <Badge>{data.trigger}</Badge>
              {(data.repair_count ?? 0) > 0 && <Badge tone="warning">{data.repair_count} repair(s)</Badge>}
              <span>started {formatDateTime(data.started_at)}</span>
              <span>· {formatDuration(data.duration_ms)}</span>
              {data.end_state_message && <span>· {data.end_state_message}</span>}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={run.reload}>Refresh</Button>
            {active && <Button variant="danger" icon={<Ban size={14} />} onClick={cancel} loading={busy}>Cancel run</Button>}
            {canRepair && <Button variant="primary" icon={<Wrench size={14} />} onClick={repair} loading={busy}>Repair run</Button>}
          </>
        }
      />

      <div className="px-6">
        {run.loading && <Skeleton style={{ height: 240 }} />}
        {run.error && <ErrorBanner message={run.error} onRetry={run.reload} />}

        {data?.trigger_params && Object.keys(data.trigger_params).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(data.trigger_params).map(([k, v]) => (
              <Badge key={k}>
                <span className="mono">{k}={v}</span>
              </Badge>
            ))}
          </div>
        )}

        {data?.error && (
          <div className="mb-4 rounded-[4px] p-3" style={{ background: "var(--bg-danger)", border: "1px solid var(--border-danger)" }}>
            <div className="font-medium" style={{ fontSize: 13, color: "var(--text-danger)" }}>Run failed</div>
            <pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap" style={{ fontSize: 12, margin: 0 }}>{data.error}</pre>
          </div>
        )}

        {data && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SegmentedControl options={VIEWS} value={view} onChange={setView} />
              <span className="ml-auto" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {data.task_runs.length} tasks
              </span>
            </div>

            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                {view === "graph" && (
                  <RunGraph run={data} selectedKey={selectedKey} onSelect={setSelectedKey} />
                )}
                {view === "timeline" && (
                  <TimelineView run={data} selectedKey={selectedKey} onSelect={setSelectedKey} />
                )}
                {view === "list" && (
                  <ListView run={data} selectedKey={selectedKey} onSelect={setSelectedKey} />
                )}
              </div>

              {selected && <TaskRunPanel task={selected} onClose={() => setSelectedKey(null)} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- node shape */

/** Card geometry and meta rows shared by the run graph. */
function runRows(t: TaskRun): { icon: React.ReactNode; text: string }[] {
  const { label, Icon } = taskTypeMeta(t.type);
  const rows: { icon: React.ReactNode; text: string }[] = [
    {
      icon: <StatusGlyph status={t.status} size={11} />,
      text: `${statusLabel(t.status)}${t.duration_ms != null ? ` · ${formatDuration(t.duration_ms)}` : ""}`,
    },
  ];
  if (t.type !== "condition") rows.push({ icon: <Icon size={11} />, text: label });
  if (t.row_count != null) rows.push({ icon: <Folder size={11} />, text: `${formatNumber(t.row_count)} rows` });
  rows.push({ icon: <Server size={11} />, text: t.cluster || "Serverless" });
  return rows;
}

function runGeometry(t: TaskRun) {
  const isLoop = (t.iterations?.length ?? 0) > 0 || t.type === "for_each";
  const isCond = t.type === "condition";
  const runIfPad = (t.depends_on?.length ?? 0) > 0 && t.run_if && t.run_if !== "ALL_SUCCESS" ? RUN_IF_PAD : 0;
  const h = isCond ? cardHeight(1) + ARMS_H : cardHeight(runRows(t).length);
  return {
    isLoop,
    isCond,
    runIfPad,
    h,
    padTop: runIfPad + (isLoop ? FOR_EACH_PAD.top : 0),
    padLeft: isLoop ? FOR_EACH_PAD.side : 0,
    padRight: isLoop ? FOR_EACH_PAD.side : 0,
    padBottom: isLoop ? FOR_EACH_PAD.bottom : 0,
  };
}

/* --------------------------------------------------------------------- graph */

function RunGraph({
  run,
  selectedKey,
  onSelect,
}: {
  run: JobRun;
  selectedKey: string | null;
  onSelect: (k: string | null) => void;
}) {
  const nodes = useMemo(() => run.task_runs.map((t) => ({ id: t.key, task: t })), [run.task_runs]);
  const edges = useMemo(
    () =>
      run.task_runs.flatMap((t) =>
        (t.depends_on ?? []).map((d) => ({ source: d.key, target: t.key, outcome: d.outcome })),
      ),
    [run.task_runs],
  );

  const nodeBox = useCallback((n: { task: TaskRun }) => {
    const g = runGeometry(n.task);
    return {
      w: CARD_W,
      h: g.h,
      padTop: g.padTop,
      padLeft: g.padLeft,
      padRight: g.padRight,
      padBottom: g.padBottom,
      ports: g.isCond ? conditionPorts(g.h) : undefined,
    };
  }, []);

  return (
    <Dag
      nodes={nodes}
      edges={edges}
      height={520}
      selectedId={selectedKey}
      onSelect={onSelect}
      searchText={(n) => `${n.task.name} ${n.task.key} ${n.task.type} ${n.task.status}`}
      nodeBox={nodeBox}
      edgeColor={(e) => {
        // A branch the run didn't take stays grey.
        const source = run.task_runs.find((t) => t.key === e.source);
        if (e.outcome === "true" || e.outcome === "false") {
          const taken = source?.condition_result;
          if (taken != null && (e.outcome === "true") !== taken) return "var(--border-strong)";
        }
        return "var(--dag-edge)";
      }}
      renderDecoration={(n) => {
        const t = n.task;
        const g = runGeometry(t);
        return (
          <>
            {g.runIfPad > 0 && t.run_if && <RunIfCaption text={RUN_IF_LABEL[t.run_if]} />}
            {g.isLoop && (
              <ForEachFrame
                label={`${t.name} · ${t.iterations?.length ?? 0} iterations`}
                top={g.runIfPad + FOR_EACH_PAD.top - 12}
              />
            )}
          </>
        );
      }}
      renderNode={(n, { selected }) => {
        const t = n.task;
        const g = runGeometry(t);
        const excluded = t.status === "EXCLUDED" || t.status === "SKIPPED";
        return (
          <NodeCard accent={statusColor(t.status)} selected={selected} faded={excluded}>
            <NodeTitle
              name={t.name}
              muted={excluded}
              right={<span style={{ color: statusColor(t.status) }}><StatusGlyph status={t.status} /></span>}
            />
            {g.isCond ? (
              <>
                <NodeRow icon={<StatusGlyph status={t.status} size={11} />}>
                  {statusLabel(t.status)}
                  {t.duration_ms != null ? ` · ${formatDuration(t.duration_ms)}` : ""}
                </NodeRow>
                <ConditionArms taken={t.condition_result} />
              </>
            ) : (
              runRows(t).map((r, i) => (
                <NodeRow key={i} icon={r.icon} title={r.text}>
                  {r.text}
                </NodeRow>
              ))
            )}
          </NodeCard>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ timeline */

const TIMELINE_LABEL_W = 200;
/** Right inset shared by the axis header, the gridlines and the bar tracks. */
const TRACK_PAD = 12;

/** A Gantt of the run: one bar per task on a shared wall-clock axis, with the
 *  statements a task issued nested underneath it. */
function TimelineView({
  run,
  selectedKey,
  onSelect,
}: {
  run: JobRun;
  selectedKey: string | null;
  onSelect: (k: string | null) => void;
}) {
  const rows = run.task_runs;
  const live = run.status === "RUNNING" || rows.some((t) => t.started_at && !t.ended_at);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [live]);

  const times = rows
    .flatMap((t) => [t.started_at, t.ended_at])
    .filter(Boolean)
    .map((s) => new Date(s as string).getTime());
  const t0 = times.length ? Math.min(...times) : new Date(run.started_at).getTime();
  const t1 = Math.max(times.length ? Math.max(...times) : now, live ? now : t0 + 1);
  const span = Math.max(1, t1 - t0);

  // Five evenly spaced wall-clock ticks across the timeline header.
  const subSecond = span < 10_000;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const at = new Date(t0 + (span * i) / 4);
    const clock = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    return {
      pct: (i / 4) * 100,
      // Short runs would otherwise print the same second five times over.
      label: subSecond ? `${clock.replace(/ [AP]M$/, "")}.${String(at.getMilliseconds()).padStart(3, "0")}` : clock,
    };
  });

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const bar = (start: number, end: number) => ({
    left: `${((start - t0) / span) * 100}%`,
    width: `${Math.max(0.4, ((end - start) / span) * 100)}%`,
  });

  return (
    <div className="lh-card overflow-hidden">
      {/* Axis header */}
      <div
        className="flex items-stretch"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--table-header-bg)" }}
      >
        <div
          className="shrink-0 px-3 py-1.5 font-medium"
          style={{ width: TIMELINE_LABEL_W, fontSize: 12, color: "var(--text-secondary)" }}
        >
          Task name
        </div>
        <div
          className="relative flex-1"
          style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: TRACK_PAD }}
        >
          {ticks.map((tick, i) => (
            <span
              key={i}
              className="absolute top-1.5 whitespace-nowrap"
              style={{
                left: `${tick.pct}%`,
                transform: i === ticks.length - 1 ? "translateX(-100%)" : i === 0 ? "none" : "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* Gridlines behind the bars */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ left: TIMELINE_LABEL_W, right: TRACK_PAD }}
        >
          {ticks.map((tick, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{ left: `${tick.pct}%`, borderLeft: "1px solid var(--border)" }}
            />
          ))}
        </div>

        {rows.map((t) => {
          const ran = !!t.started_at;
          const start = ran ? new Date(t.started_at as string).getTime() : t0;
          const end = t.ended_at && ran ? new Date(t.ended_at).getTime() : live && ran ? now : start;
          const children = t.iterations ?? [];
          const open = expanded.has(t.key);
          const isSelected = selectedKey === t.key;

          return (
            <React.Fragment key={t.key}>
              <div
                onClick={() => onSelect(isSelected ? null : t.key)}
                className="relative flex cursor-pointer items-stretch"
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: isSelected ? "var(--table-row-selected)" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--table-row-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  className="flex shrink-0 items-center gap-1 px-2 py-1.5"
                  style={{ width: TIMELINE_LABEL_W, fontSize: 12 }}
                >
                  {children.length > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(t.key);
                      }}
                      aria-label={open ? "Collapse" : "Expand"}
                      className="shrink-0"
                      style={{ color: "var(--action-icon-default)" }}
                    >
                      <ChevronRight
                        size={13}
                        style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
                      />
                    </button>
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  <span style={{ color: statusColor(t.status), display: "flex" }}>
                    <StatusGlyph status={t.status} size={12} />
                  </span>
                  <span className="truncate" title={t.name}>{t.name}</span>
                </div>

                <div className="relative flex-1 py-1.5" style={{ marginRight: TRACK_PAD }}>
                  {!ran ? (
                    <span
                      className="absolute whitespace-nowrap"
                      style={{ left: 0, top: 8, fontSize: 11, color: "var(--text-secondary)" }}
                    >
                      {statusLabel(t.status)} — did not run
                    </span>
                  ) : (() => {
                    const geo = bar(start, end);
                    // Narrow bars can't hold their label, so it sits just after them.
                    const inside = parseFloat(geo.width) > 8;
                    const duration = formatDuration(t.duration_ms);
                    return (
                      <>
                        <div
                          className="absolute flex h-5 items-center rounded-[3px]"
                          style={{
                            ...geo,
                            top: 6,
                            minWidth: 4,
                            padding: inside ? "0 6px" : 0,
                            background: statusColor(t.status),
                            color: "#fff",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                          }}
                          title={`${statusLabel(t.status)} · ${duration}`}
                        >
                          {inside && duration}
                        </div>
                        {!inside && (
                          <span
                            className="absolute whitespace-nowrap"
                            style={{
                              left: `calc(${geo.left} + ${geo.width})`,
                              top: 8,
                              marginLeft: 6,
                              fontSize: 11,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {duration}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {open &&
                (() => {
                  // Iterations report a duration but no wall-clock stamps, so lay
                  // them end to end inside the parent task's bar, scaled down if
                  // their durations add up to more than the parent's window.
                  const total = children.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);
                  const scale = total > 0 && total > end - start ? (end - start) / total : 1;
                  let cursor = start;
                  return children.map((it) => {
                    const cs = cursor;
                    const ce = cs + (it.duration_ms ?? 0) * scale;
                    cursor = ce;
                    return (
                      <div
                        key={`${t.key}-${it.index}`}
                        className="relative flex items-stretch"
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                      <div
                        className="flex shrink-0 items-center gap-1 py-1 pl-8 pr-2"
                        style={{ width: TIMELINE_LABEL_W, fontSize: 11, color: "var(--text-secondary)" }}
                      >
                        <span className="mono truncate" title={JSON.stringify(it.input)}>
                          {JSON.stringify(it.input)}
                        </span>
                      </div>
                        <div className="relative flex-1 py-1" style={{ marginRight: TRACK_PAD }}>
                        <div
                          className="absolute h-3.5 rounded-[3px]"
                          style={{
                            ...bar(cs, ce),
                            top: 4,
                            minWidth: 3,
                            background: statusColor(it.status),
                            opacity: 0.75,
                          }}
                          title={`${statusLabel(it.status)} · ${formatDuration(it.duration_ms)}`}
                        />
                      </div>
                      </div>
                    );
                  });
                })()}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- list */

/** The searchable, filterable table behind the List view. */
function ListView({
  run,
  selectedKey,
  onSelect,
}: {
  run: JobRun;
  selectedKey: string | null;
  onSelect: (k: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");

  const types = useMemo(
    () => [...new Set(run.task_runs.map((t) => t.type))].sort(),
    [run.task_runs],
  );
  const statuses = useMemo(
    () => [...new Set(run.task_runs.map((t) => t.status))].sort(),
    [run.task_runs],
  );

  const rows = run.task_runs.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      (type === "all" || t.type === type) &&
      (query.trim() === "" || t.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="lh-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search by task name" className="w-64" />
        <Select
          value={status}
          onChange={setStatus}
          ariaLabel="Filter by status"
          className="w-44"
          options={[{ value: "all", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))]}
        />
        <Select
          value={type}
          onChange={setType}
          ariaLabel="Filter by type"
          className="w-44"
          options={[{ value: "all", label: "All task types" }, ...types.map((t) => ({ value: t, label: taskTypeMeta(t).label }))]}
        />
      </div>
      <DataTable
        rows={rows}
        keyOf={(t) => t.key}
        onRowClick={(t) => onSelect(selectedKey === t.key ? null : t.key)}
        emptyMessage="No tasks match these filters"
        columns={[
          { key: "status", header: "Status", width: 130, render: (t: TaskRun) => <StatusBadge status={t.status} /> },
          {
            key: "name",
            header: "Task name",
            render: (t: TaskRun) => <span className="font-medium">{t.name}</span>,
          },
          {
            key: "type",
            header: "Task type",
            width: 150,
            render: (t: TaskRun) => {
              const { label, Icon } = taskTypeMeta(t.type);
              return (
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                  <Icon size={13} />
                  {label}
                </span>
              );
            },
          },
          {
            key: "compute",
            header: "Compute",
            width: 140,
            render: (t: TaskRun) => (
              <span style={{ color: "var(--text-secondary)" }}>{t.cluster || "Serverless"}</span>
            ),
          },
          {
            key: "duration",
            header: "Duration",
            width: 110,
            align: "right",
            render: (t: TaskRun) => formatDuration(t.duration_ms),
          },
          {
            key: "deps",
            header: "Depends on",
            width: 200,
            render: (t: TaskRun) =>
              (t.depends_on ?? []).length === 0 ? (
                <span style={{ color: "var(--text-secondary)" }}>—</span>
              ) : (
                <span className="mono truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {t.depends_on
                    .map((d) => (d.outcome === "true" || d.outcome === "false" ? `${d.key}:${d.outcome}` : d.key))
                    .join(", ")}
                </span>
              ),
          },
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------- detail panel */

/** The side panel that opens when you pick a task in a run. */
function TaskRunPanel({ task, onClose }: { task: TaskRun; onClose: () => void }) {
  const attempts = task.attempts ?? [];
  const iterations = task.iterations ?? [];
  const outputs = Object.entries(task.output ?? {});
  const { label, Icon } = taskTypeMeta(task.type);

  return (
    <aside className="lh-card shrink-0 self-start overflow-hidden" style={{ width: 340 }}>
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span style={{ color: statusColor(task.status), display: "flex" }}>
          <StatusGlyph status={task.status} />
        </span>
        <span className="truncate font-semibold" style={{ fontSize: 13 }} title={task.name}>
          {task.name}
        </span>
        <button onClick={onClose} aria-label="Close" className="ml-auto" style={{ color: "var(--action-icon-default)" }}>
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3" style={{ fontSize: 12 }}>
        <PanelRow label="Status"><StatusBadge status={task.status} /></PanelRow>
        <PanelRow label="Task type">
          <span className="flex items-center gap-1.5"><Icon size={13} />{label}</span>
        </PanelRow>
        <PanelRow label="Compute">{task.cluster || "Serverless"}</PanelRow>
        <PanelRow label="Start time">{formatDateTime(task.started_at)}</PanelRow>
        <PanelRow label="End time">{formatDateTime(task.ended_at)}</PanelRow>
        <PanelRow label="Duration">{formatDuration(task.duration_ms)}</PanelRow>
        {task.row_count != null && <PanelRow label="Rows">{formatNumber(task.row_count)}</PanelRow>}
        {task.condition_result != null && (
          <PanelRow label="Condition">
            <b>{task.condition_result ? "true" : "false"}</b>
          </PanelRow>
        )}
        {(task.depends_on ?? []).length > 0 && (
          <PanelRow label="Depends on">
            <span className="mono">
              {task.depends_on
                .map((d) => (d.outcome === "true" || d.outcome === "false" ? `${d.key}:${d.outcome}` : d.key))
                .join(", ")}
            </span>
          </PanelRow>
        )}
        {task.message && <div style={{ color: "var(--text-secondary)" }}>{task.message}</div>}
      </div>

      {outputs.length > 0 && (
        <PanelSection title="Task values">
          <div className="flex flex-wrap gap-1.5">
            {outputs.map(([k, v]) => (
              <Badge key={k}>
                <span className="mono">{k} = {String(v)}</span>
              </Badge>
            ))}
          </div>
        </PanelSection>
      )}

      {attempts.length > 0 && (
        <PanelSection title={`Attempts (${attempts.length})`}>
          <div className="flex flex-col gap-1">
            {attempts.map((a) => (
              <div key={a.n} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                <span className="mono w-6">#{a.n}</span>
                <StatusBadge status={a.status} />
                <span style={{ color: "var(--text-secondary)" }}>{formatDuration(a.duration_ms)}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      {iterations.length > 0 && (
        <PanelSection title={`Iterations (${iterations.length})`}>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {iterations.map((it) => (
              <div key={it.index} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                <span className="mono truncate" style={{ maxWidth: 150 }}>{JSON.stringify(it.input)}</span>
                <StatusBadge status={it.status} />
                <span className="ml-auto" style={{ color: "var(--text-secondary)" }}>{formatDuration(it.duration_ms)}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      {(task.query_ids ?? []).length > 0 && (
        <PanelSection title="Statements">
          <div className="flex flex-wrap gap-2">
            {task.query_ids!.map((q) => (
              <Link key={q} href={`/query-history?q=${q}`} className="mono" style={{ fontSize: 12, color: "var(--link)" }}>
                {q.slice(0, 8)}
              </Link>
            ))}
          </div>
        </PanelSection>
      )}

      {task.error && (
        <PanelSection title="Error">
          <pre
            className="mono overflow-x-auto whitespace-pre-wrap rounded-[4px] p-2"
            style={{ margin: 0, fontSize: 11.5, background: "var(--bg-danger)", color: "var(--text-danger)" }}
          >
            {task.error}
          </pre>
        </PanelSection>
      )}
    </aside>
  );
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-24 shrink-0" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="mb-1.5 font-medium" style={{ fontSize: 12 }}>{title}</div>
      {children}
    </div>
  );
}
