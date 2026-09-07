"use client";

import {
  ChevronDown, CircleCheck, CircleOff, Copy, Folder, Pause, Play, Plus, RefreshCw, Repeat, RotateCcw, Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Dag } from "@/components/Dag";
import { PageHeader } from "@/components/shell/PageHeader";
import {
  Badge, Button, DataTable, ErrorBanner, Field, IconButton, Input, Modal, Select, Skeleton,
  StatusBadge, Tabs, Textarea, useToast,
} from "@/components/ui";
import {
  ARMS_H, CARD_W, COND_ROW_H, ConditionArms, FOR_EACH_PAD, ForEachFrame, NodeCard, NodeRow, NodeTitle, RUN_IF_LABEL,
  RUN_IF_PAD, RunIfCaption, cardHeight, conditionPorts, ConditionExpression, taskTypeMeta,
} from "@/components/jobs/graph";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, formatRelative, statusColor, statusLabel } from "@/lib/format";
import { CRON_PRESETS, scheduleLabel } from "@/lib/schedule";
import type { Job, JobTask, RunIf, Schedule, TaskType } from "@/lib/types";
import { useAsync, useInterval } from "@/lib/useAsync";

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: "sql", label: "SQL" },
  { value: "notebook", label: "Notebook" },
  { value: "saved_query", label: "Saved query" },
  { value: "dashboard", label: "Dashboard refresh" },
  { value: "condition", label: "Condition (if/else)" },
  { value: "for_each", label: "For each" },
  { value: "run_job", label: "Run job" },
  { value: "pipeline", label: "Pipeline" },
];

const RUN_IF: { value: RunIf; label: string }[] = [
  { value: "ALL_SUCCESS", label: "All dependencies succeeded" },
  { value: "ALL_DONE", label: "All dependencies done" },
  { value: "NONE_FAILED", label: "No dependency failed" },
  { value: "AT_LEAST_ONE_SUCCESS", label: "At least one succeeded" },
  { value: "AT_LEAST_ONE_FAILED", label: "At least one failed" },
  { value: "ALL_FAILED", label: "All dependencies failed" },
];

/** The pickable targets a task can point at, fetched once for the whole page. */
function useJobResources() {
  const notebooks = useAsync(() => api.notebooks.list(), []);
  const savedQueries = useAsync(() => api.sql.saved(), []);
  const dashboards = useAsync(() => api.dashboards.list(), []);
  const jobs = useAsync(() => api.jobs.list(), []);
  const pipelines = useAsync(() => api.pipelines.list(), []);
  return { notebooks, savedQueries, dashboards, jobs, pipelines };
}

type JobResources = ReturnType<typeof useJobResources>;

function blankTask(key: string): JobTask {
  return {
    key,
    name: key,
    description: "",
    type: "sql",
    sql: "",
    notebook_id: null,
    query_id: null,
    dashboard_id: null,
    run_job_id: null,
    pipeline_id: null,
    condition: null,
    for_each: null,
    inner_task: null,
    depends_on: [],
    run_if: "ALL_SUCCESS",
    retry: { max_retries: 0, min_retry_interval_millis: 0, retry_on_timeout: false },
    timeout_seconds: 0,
    parameters: {},
    capture_output: false,
    disabled: false,
  };
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const job = useAsync(async (): Promise<Job> => {
    const j = await api.jobs.get(id);
    // Tolerate rows from an older schema (or a stale backend) where JSON columns
    // arrive unparsed or absent.
    return {
      ...j,
      tasks: Array.isArray(j.tasks) ? j.tasks : [],
      tags: Array.isArray(j.tags) ? j.tags : [],
      parameters: Array.isArray(j.parameters) ? j.parameters : [],
      notifications:
        j.notifications && typeof j.notifications === "object" && !Array.isArray(j.notifications)
          ? j.notifications
          : ({
              on_start: [],
              on_success: [],
              on_failure: [],
              on_duration_warning: [],
              min_duration_warning_seconds: 0,
            } as Job["notifications"]),
    };
  }, [id]);
  const runs = useAsync(() => api.jobs.runs(id, 50), [id]);
  const resources = useJobResources();
  const [tab, setTab] = useState("tasks");
  const [draft, setDraft] = useState<Job | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runParamsOpen, setRunParamsOpen] = useState(false);
  const [runParams, setRunParams] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (job.data) {
      setDraft(structuredClone(job.data));
      setSelectedKey((k) => k ?? job.data!.tasks[0]?.key ?? null);
    }
  }, [job.data]);

  useInterval(() => {
    if ((runs.data ?? []).some((r) => r.status === "RUNNING" || r.status === "QUEUED")) runs.reload();
  }, 2500);

  const dirty = useMemo(
    () => draft && job.data && JSON.stringify(draft) !== JSON.stringify(job.data),
    [draft, job.data],
  );

  const patchTask = (key: string, patch: Partial<JobTask>) =>
    setDraft((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map((t) => (t.key === key ? { ...t, ...patch } : t)) } : prev,
    );

  const addTask = (afterKey?: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      let n = prev.tasks.length + 1;
      while (prev.tasks.some((t) => t.key === `task_${n}`)) n++;
      const t = blankTask(`task_${n}`);
      if (afterKey) t.depends_on = [{ key: afterKey, outcome: "success" }];
      setSelectedKey(t.key);
      return { ...prev, tasks: [...prev.tasks, t] };
    });
  };

  const duplicateTask = (key: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const src = prev.tasks.find((t) => t.key === key);
      if (!src) return prev;
      let n = prev.tasks.length + 1;
      while (prev.tasks.some((t) => t.key === `${src.key}_copy${n}`)) n++;
      const copy = { ...structuredClone(src), key: `${src.key}_copy${n}`, name: `${src.name ?? src.key} copy` };
      setSelectedKey(copy.key);
      return { ...prev, tasks: [...prev.tasks, copy] };
    });
  };

  const removeTask = (key: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const tasks = prev.tasks
        .filter((t) => t.key !== key)
        .map((t) => ({ ...t, depends_on: t.depends_on.filter((d) => d.key !== key) }));
      setSelectedKey(tasks[0]?.key ?? null);
      return { ...prev, tasks };
    });
  };

  const renameTask = (oldKey: string, newKey: string) => {
    const clean = newKey.trim().replace(/[^\w]/g, "_");
    if (!clean) return;
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.tasks.some((t) => t.key === clean && t.key !== oldKey)) return prev;
      const tasks = prev.tasks.map((t) => ({
        ...t,
        key: t.key === oldKey ? clean : t.key,
        depends_on: t.depends_on.map((d) => (d.key === oldKey ? { ...d, key: clean } : d)),
      }));
      setSelectedKey(clean);
      return { ...prev, tasks };
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.jobs.update(id, {
        name: draft.name,
        description: draft.description,
        tasks: draft.tasks,
        schedule: draft.schedule ?? undefined,
        paused: draft.paused,
        tags: draft.tags,
        parameters: draft.parameters,
        max_concurrent_runs: draft.max_concurrent_runs,
        timeout_seconds: draft.timeout_seconds,
        queue_enabled: draft.queue_enabled,
        continuous: draft.continuous,
        notifications: draft.notifications,
      });
      toast("Job saved", "success");
      setErrors([]);
      job.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save";
      setErrors(msg.split("; "));
      toast(msg, "danger");
    } finally {
      setSaving(false);
    }
  };

  const triggerRun = async (params: Record<string, string> = {}) => {
    setRunning(true);
    try {
      const run = await api.jobs.run(id, params);
      toast(`Run #${run.run_number} started`, "info");
      router.push(`/job-runs/${run.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Run failed", "danger");
    } finally {
      setRunning(false);
      setRunParamsOpen(false);
    }
  };

  const onRunNow = () => {
    if ((job.data?.parameters.length ?? 0) > 0) {
      setRunParams(Object.fromEntries((job.data!.parameters).map((p) => [p.name, p.default])));
      setRunParamsOpen(true);
    } else {
      triggerRun();
    }
  };

  const selected = draft?.tasks.find((t) => t.key === selectedKey) ?? null;

  /** The "source" line on a task card — the notebook, query or job it points at. */
  const sourceLabel = useCallback(
    (t: JobTask): string | null => {
      const find = (list: { id: string; name: string }[] | null | undefined, id?: string | null) =>
        id ? list?.find((x) => x.id === id)?.name ?? id : null;
      switch (t.type) {
        case "notebook":
          return find(resources.notebooks.data, t.notebook_id);
        case "saved_query":
          return find(resources.savedQueries.data, t.query_id);
        case "dashboard":
          return find(resources.dashboards.data, t.dashboard_id);
        case "run_job":
          return find(resources.jobs.data, t.run_job_id);
        case "pipeline":
          return find(resources.pipelines.data, t.pipeline_id);
        case "sql":
          return t.sql.trim().split("\n")[0]?.slice(0, 64) || null;
        default:
          return null;
      }
    },
    [resources],
  );

  return (
    <div className="pb-10">
      <PageHeader
        title={job.data?.name ?? "Job"}
        breadcrumbs={[{ label: "Jobs & Pipelines", href: "/jobs" }, { label: job.data?.name ?? "" }]}
        description={
          job.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={job.data.paused ? "neutral" : "success"}>{job.data.paused ? "Paused" : "Active"}</Badge>
              <span>{job.data.continuous ? "Continuous" : scheduleLabel(job.data.schedule)}</span>
              {job.data.next_run_at && !job.data.paused && <span>· next run {formatRelative(job.data.next_run_at)}</span>}
              {job.data.success_rate != null && <span>· {job.data.success_rate}% success over {job.data.run_count} runs</span>}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button icon={<Save size={14} />} onClick={save} loading={saving} disabled={!dirty}>
              Save
            </Button>
            <Button variant="primary" icon={<Play size={14} />} onClick={onRunNow} loading={running}>
              Run now
            </Button>
          </>
        }
      />

      <div className="px-6">
        <Tabs
          active={tab}
          onChange={setTab}
          className="mb-4"
          tabs={[
            { id: "tasks", label: "Tasks", count: draft?.tasks.length },
            { id: "runs", label: "Runs", count: runs.data?.length },
            { id: "schedule", label: "Schedule & triggers" },
            { id: "parameters", label: "Parameters", count: draft?.parameters.length || undefined },
            { id: "notifications", label: "Notifications" },
            { id: "settings", label: "Settings" },
          ]}
        />

        {job.loading && <Skeleton style={{ height: 240 }} />}
        {job.error && <ErrorBanner message={job.error} onRetry={job.reload} />}
        {errors.length > 0 && (
          <div className="mb-3">
            <ErrorBanner message={errors.join(" · ")} />
          </div>
        )}

        {tab === "tasks" && draft && (
          <div className="flex items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <TaskGraph
                tasks={draft.tasks}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onAdd={() => addTask(selectedKey ?? undefined)}
                onAddDownstream={(k) => addTask(k)}
                onDuplicate={duplicateTask}
                onRemove={removeTask}
                onToggleDisabled={(k) => {
                  const t = draft.tasks.find((x) => x.key === k);
                  if (t) patchTask(k, { disabled: !t.disabled });
                }}
                sourceLabel={sourceLabel}
              />
              {selected ? (
                <TaskPanel
                  job={draft}
                  task={selected}
                  resources={resources}
                  onPatch={(patch) => patchTask(selected.key, patch)}
                  onRename={(k) => renameTask(selected.key, k)}
                  onDuplicate={() => duplicateTask(selected.key)}
                  onRemove={() => removeTask(selected.key)}
                  onAddDownstream={() => addTask(selected.key)}
                />
              ) : (
                <div className="lh-card p-6 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  Select a task in the graph, or <button className="underline" onClick={() => addTask()}>add one</button>.
                </div>
              )}
            </div>
            <JobDetailsPanel
              job={draft}
              onGoToTab={setTab}
              onTogglePause={() => setDraft((p) => (p ? { ...p, paused: !p.paused } : p))}
            />
          </div>
        )}

        {tab === "runs" && <RunsTab jobId={id} runs={runs} />}

        {tab === "schedule" && draft && (
          <ScheduleTab
            draft={draft}
            onChange={(patch) => setDraft((p) => (p ? { ...p, ...patch } : p))}
            onSave={save}
            saving={saving}
          />
        )}

        {tab === "parameters" && draft && (
          <ParametersTab
            params={draft.parameters}
            onChange={(parameters) => setDraft((p) => (p ? { ...p, parameters } : p))}
            onSave={save}
            saving={saving}
          />
        )}

        {tab === "notifications" && draft && (
          <NotificationsTab
            jobId={id}
            settings={draft.notifications}
            onChange={(notifications) => setDraft((p) => (p ? { ...p, notifications } : p))}
            onSave={save}
            saving={saving}
          />
        )}

        {tab === "settings" && draft && (
          <SettingsTab
            draft={draft}
            onChange={(patch) => setDraft((p) => (p ? { ...p, ...patch } : p))}
            onSave={save}
            saving={saving}
            onDelete={async () => {
              if (!confirm(`Delete job “${draft.name}” and its run history?`)) return;
              await api.jobs.remove(id);
              toast("Job deleted", "success");
              router.push("/jobs");
            }}
          />
        )}
      </div>

      <Modal
        open={runParamsOpen}
        onClose={() => setRunParamsOpen(false)}
        title="Run with parameters"
        footer={
          <>
            <Button onClick={() => setRunParamsOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={running} onClick={() => triggerRun(runParams)}>
              Run
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {(job.data?.parameters ?? []).map((p) => (
            <Field key={p.name} label={p.name}>
              <Input
                value={runParams[p.name] ?? ""}
                onChange={(e) => setRunParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- task graph */

/** The Tasks tab canvas: a task graph you can pan, zoom,
 *  search, and edit through the toolbar that floats over the selected node. */
function TaskGraph({
  tasks,
  selectedKey,
  onSelect,
  onAdd,
  onAddDownstream,
  onDuplicate,
  onRemove,
  onToggleDisabled,
  sourceLabel,
}: {
  tasks: JobTask[];
  selectedKey: string | null;
  onSelect: (k: string | null) => void;
  onAdd: () => void;
  onAddDownstream: (k: string) => void;
  onDuplicate: (k: string) => void;
  onRemove: (k: string) => void;
  onToggleDisabled: (k: string) => void;
  sourceLabel: (t: JobTask) => string | null;
}) {
  const nodes = useMemo(() => tasks.map((t) => ({ id: t.key, task: t })), [tasks]);
  const edges = useMemo(
    () => tasks.flatMap((t) => t.depends_on.map((d) => ({ source: d.key, target: t.key, outcome: d.outcome }))),
    [tasks],
  );

  /** Meta rows under the title of a task card. */
  const rowsOf = (t: JobTask): { icon: React.ReactNode; text: string }[] => {
    const { label, Icon } = taskTypeMeta(t.type);
    const rows: { icon: React.ReactNode; text: string }[] = [];
    if (t.type !== "condition") rows.push({ icon: <Icon size={11} />, text: label });
    const source = sourceLabel(t);
    if (source) rows.push({ icon: <Folder size={11} />, text: source });
    if (t.type === "for_each") {
      const count = (() => {
        try {
          const parsed = JSON.parse(t.for_each?.inputs || "[]");
          return Array.isArray(parsed) ? parsed.length : "?";
        } catch {
          return "?";
        }
      })();
      rows.push({ icon: <Repeat size={11} />, text: `${count} iterations · ${t.inner_task?.type ?? "no task"}` });
    }
    if (t.retry.max_retries > 0 || t.timeout_seconds > 0) {
      rows.push({
        icon: <RotateCcw size={11} />,
        text: [t.retry.max_retries > 0 && `${t.retry.max_retries} retries`, t.timeout_seconds > 0 && `${t.timeout_seconds}s timeout`]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return rows;
  };

  const geometry = (t: JobTask) => {
    const isLoop = t.type === "for_each";
    const isCond = t.type === "condition";
    const runIfPad = t.depends_on.length > 0 && t.run_if !== "ALL_SUCCESS" ? RUN_IF_PAD : 0;
    const h = isCond
      ? cardHeight(0, false) + COND_ROW_H + ARMS_H
      : cardHeight(Math.max(1, rowsOf(t).length), false);
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
  };

  const nodeBox = useCallback((n: { task: JobTask }) => {
    const g = geometry(n.task);
    return {
      w: CARD_W,
      h: g.h,
      padTop: g.padTop,
      padLeft: g.padLeft,
      padRight: g.padRight,
      padBottom: g.padBottom,
      ports: g.isCond ? conditionPorts(g.h) : undefined,
    };
    // `geometry` is derived from the task passed in, so it needs no dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dag
      nodes={nodes}
      edges={edges}
      selectedId={selectedKey}
      onSelect={onSelect}
      height={520}
      onAdd={onAdd}
      addLabel="Add task"
      searchText={(n) => `${n.task.name ?? ""} ${n.task.key} ${n.task.type}`}
      nodeBox={nodeBox}
      renderDecoration={(n) => {
        const t = n.task;
        const g = geometry(t);
        return (
          <>
            {g.runIfPad > 0 && <RunIfCaption text={RUN_IF_LABEL[t.run_if]} />}
            {g.isLoop && <ForEachFrame label={t.name || t.key} top={g.runIfPad + FOR_EACH_PAD.top - 12} />}
          </>
        );
      }}
      renderNodeToolbar={(n) => (
        <>
          <IconButton title="Add downstream task" onClick={() => onAddDownstream(n.id)}>
            <Plus size={14} />
          </IconButton>
          <IconButton title="Clone task" onClick={() => onDuplicate(n.id)}>
            <Copy size={14} />
          </IconButton>
          <IconButton
            title={n.task.disabled ? "Enable task" : "Disable task"}
            onClick={() => onToggleDisabled(n.id)}
          >
            {n.task.disabled ? <CircleCheck size={14} /> : <CircleOff size={14} />}
          </IconButton>
          <IconButton title="Delete task" onClick={() => onRemove(n.id)}>
            <Trash2 size={14} />
          </IconButton>
        </>
      )}
      renderNode={(n, { selected }) => {
        const t = n.task;
        const g = geometry(t);
        return (
          <NodeCard
            selected={selected}
            dashed={t.disabled}
            faded={t.disabled}
          >
            <NodeTitle
              name={t.name || t.key}
              muted={t.disabled}
              right={t.disabled ? <CircleOff size={13} style={{ color: "var(--text-secondary)" }} /> : undefined}
            />
            {g.isCond ? (
              <>
                <ConditionExpression condition={t.condition} />
                <ConditionArms />
              </>
            ) : (
              rowsOf(t).map((r, i) => (
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

/* ------------------------------------------------------------ job details panel */

/** The right-hand summary rail pinned beside the task graph. */
function JobDetailsPanel({
  job,
  onGoToTab,
  onTogglePause,
}: {
  job: Job;
  onGoToTab: (tab: string) => void;
  onTogglePause: () => void;
}) {
  const toast = useToast();
  const copy = (value: string) => {
    navigator.clipboard?.writeText(value);
    toast("Copied", "info");
  };

  return (
    <aside className="lh-card shrink-0 self-start p-0" style={{ width: 320 }}>
      <div className="px-3 py-2.5 font-semibold" style={{ fontSize: 13, borderBottom: "1px solid var(--border)" }}>
        Job details
      </div>

      <DetailsSection title="Overview">
        <DetailRow label="Job ID">
          <span className="flex items-center gap-1">
            <span className="mono truncate" title={job.id}>{job.id}</span>
            <IconButton title="Copy job ID" onClick={() => copy(job.id)}>
              <Copy size={12} />
            </IconButton>
          </span>
        </DetailRow>
        <DetailRow label="Created">{formatDateTime(job.created_at)}</DetailRow>
        <DetailRow label="Last modified">{formatRelative(job.updated_at)}</DetailRow>
        <DetailRow label="Last run">
          {job.last_run ? (
            <Link href={`/job-runs/${job.last_run.id}`} style={{ color: "var(--link)" }}>
              #{job.last_run.run_number} · {statusLabel(job.last_run.status)}
            </Link>
          ) : (
            "Never run"
          )}
        </DetailRow>
        <DetailRow label="Description">
          {job.description ? (
            <span className="line-clamp-3">{job.description}</span>
          ) : (
            <button style={{ color: "var(--link)" }} onClick={() => onGoToTab("settings")}>
              Add description
            </button>
          )}
        </DetailRow>
        <DetailRow label="Tags">
          {job.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {job.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </span>
          ) : (
            "—"
          )}
        </DetailRow>
      </DetailsSection>

      <DetailsSection title="Schedules & Triggers">
        <div style={{ fontSize: 12 }}>
          {job.continuous ? "Continuous — restarts on completion" : scheduleLabel(job.schedule)}
          {job.next_run_at && !job.paused && !job.continuous && (
            <div style={{ color: "var(--text-secondary)" }}>Next run {formatRelative(job.next_run_at)}</div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => onGoToTab("schedule")}>
            Edit trigger
          </Button>
          {(job.schedule || job.continuous) && (
            <Button size="sm" icon={job.paused ? <Play size={12} /> : <Pause size={12} />} onClick={onTogglePause}>
              {job.paused ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </DetailsSection>

      <DetailsSection title="Job parameters">
        {job.parameters.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No job parameters are defined for this job</div>
        ) : (
          <div className="flex flex-col gap-1">
            {job.parameters.map((p) => (
              <div key={p.name} className="mono flex items-baseline gap-1 truncate" style={{ fontSize: 12 }}>
                <span>{p.name}</span>
                <span style={{ color: "var(--text-secondary)" }}>= {p.default || "—"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2">
          <Button size="sm" onClick={() => onGoToTab("parameters")}>
            Edit parameters
          </Button>
        </div>
      </DetailsSection>

      <DetailsSection title="Advanced" last>
        <DetailRow label="Max concurrent runs">{job.max_concurrent_runs}</DetailRow>
        <DetailRow label="Timeout">{job.timeout_seconds > 0 ? `${job.timeout_seconds}s` : "None"}</DetailRow>
        <DetailRow label="Queue">{job.queue_enabled ? "Enabled" : "Disabled"}</DetailRow>
      </DetailsSection>
    </aside>
  );
}

function DetailsSection({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <button
        className="flex w-full items-center gap-1 px-3 py-2 text-left font-medium"
        style={{ fontSize: 12.5 }}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          size={13}
          style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 120ms", color: "var(--text-secondary)" }}
        />
        {title}
      </button>
      {open && <div className="flex flex-col gap-1.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2" style={{ fontSize: 12 }}>
      <span className="w-32 shrink-0" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

/* --------------------------------------------------------------- task panel */

function TaskPanel({
  job,
  task,
  resources,
  onPatch,
  onRename,
  onDuplicate,
  onRemove,
  onAddDownstream,
}: {
  job: Job;
  task: JobTask;
  resources: JobResources;
  onPatch: (patch: Partial<JobTask>) => void;
  onRename: (key: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddDownstream: () => void;
}) {
  const { notebooks, savedQueries, dashboards, jobs, pipelines } = resources;

  const upstream = job.tasks.filter((t) => t.key !== task.key);
  const [keyDraft, setKeyDraft] = useState(task.key);
  useEffect(() => setKeyDraft(task.key), [task.key]);

  const inner = task.inner_task ?? blankTask("iteration");

  const setDep = (depKey: string, outcome: JobTask["depends_on"][number]["outcome"] | null) => {
    const rest = task.depends_on.filter((d) => d.key !== depKey);
    onPatch({ depends_on: outcome ? [...rest, { key: depKey, outcome }] : rest });
  };

  const paramRows = Object.entries(task.parameters);

  return (
    <div className="lh-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Field label="Task name" className="min-w-56">
          <Input value={task.name ?? ""} onChange={(e) => onPatch({ name: e.target.value })} />
        </Field>
        <Field label="Key" className="w-44">
          <Input
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onBlur={() => keyDraft !== task.key && onRename(keyDraft)}
            className="mono"
          />
        </Field>
        <Field label="Type" className="w-52">
          <Select value={task.type} onChange={(v) => onPatch({ type: v as TaskType })} options={TASK_TYPES} />
        </Field>
        <span className="ml-auto flex items-center gap-1 pt-5">
          <IconButton title="Duplicate task" onClick={onDuplicate}><Copy size={14} /></IconButton>
          <IconButton title="Add downstream task" onClick={onAddDownstream}><Plus size={14} /></IconButton>
          <IconButton title="Remove task" onClick={onRemove}><Trash2 size={14} /></IconButton>
        </span>
      </div>

      {/* type-specific body */}
      {(task.type === "sql") && (
        <>
          <Field label="SQL" hint="Statements run in order. References like {{job.parameters.env}} and {{tasks.other.values.x}} are substituted.">
            <Textarea value={task.sql} onChange={(e) => onPatch({ sql: e.target.value })} rows={7} className="mono" />
          </Field>
          <label className="mt-2 flex items-center gap-2" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={task.capture_output} onChange={(e) => onPatch({ capture_output: e.target.checked })} />
            Publish the first result row as task values (referenced by <span className="mono">{`{{tasks.${task.key}.values.<column>}}`}</span>)
          </label>
        </>
      )}
      {task.type === "notebook" && (
        <Picker label="Notebook" value={task.notebook_id ?? ""} onChange={(v) => onPatch({ notebook_id: v })}
          options={(notebooks.data ?? []).map((n) => ({ value: n.id, label: n.name }))} />
      )}
      {task.type === "saved_query" && (
        <Picker label="Saved query" value={task.query_id ?? ""} onChange={(v) => onPatch({ query_id: v })}
          options={(savedQueries.data ?? []).map((q) => ({ value: q.id, label: q.name }))} />
      )}
      {task.type === "dashboard" && (
        <Picker label="Dashboard" value={task.dashboard_id ?? ""} onChange={(v) => onPatch({ dashboard_id: v })}
          options={(dashboards.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {task.type === "run_job" && (
        <Picker label="Job to run" value={task.run_job_id ?? ""} onChange={(v) => onPatch({ run_job_id: v })}
          options={(jobs.data ?? []).filter((j) => j.id !== job.id).map((j) => ({ value: j.id, label: j.name }))} />
      )}
      {task.type === "pipeline" && (
        <Picker label="Pipeline to update" value={task.pipeline_id ?? ""} onChange={(v) => onPatch({ pipeline_id: v })}
          options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
      )}
      {task.type === "condition" && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="Left"><Input className="mono" value={task.condition?.left ?? ""} onChange={(e) => onPatch({ condition: { ...cond(task), left: e.target.value } })} placeholder="{{tasks.score.values.auc}}" /></Field>
          <Field label="Operator" className="w-20">
            <Select value={task.condition?.op ?? "=="} onChange={(v) => onPatch({ condition: { ...cond(task), op: v as never } })}
              options={["==", "!=", ">", ">=", "<", "<="].map((o) => ({ value: o, label: o }))} />
          </Field>
          <Field label="Right"><Input className="mono" value={task.condition?.right ?? ""} onChange={(e) => onPatch({ condition: { ...cond(task), right: e.target.value } })} placeholder="0.9" /></Field>
          <span className="col-span-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Downstream tasks depending on the <b>true</b> / <b>false</b> branch run only when the condition takes that branch; the other branch is marked <i>Excluded</i>.
          </span>
        </div>
      )}
      {task.type === "for_each" && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Field label="Inputs (JSON array, or a {{...}} reference)" className="flex-1">
              <Textarea className="mono" rows={2} value={task.for_each?.inputs ?? "[]"}
                onChange={(e) => onPatch({ for_each: { ...forEach(task), inputs: e.target.value } })}
                placeholder='["US","DE","FR"] or {{tasks.list.values.countries}}' />
            </Field>
            <Field label="Concurrency" className="w-28">
              <Input type="number" min={1} max={8} value={task.for_each?.concurrency ?? 1}
                onChange={(e) => onPatch({ for_each: { ...forEach(task), concurrency: Number(e.target.value) } })} />
            </Field>
          </div>
          <div className="rounded-[6px] p-3" style={{ border: "1px dashed var(--border-strong)" }}>
            <div className="mb-2 font-medium" style={{ fontSize: 12 }}>Nested task — each iteration sees <span className="mono">{`{{input}}`}</span></div>
            <div className="flex gap-2">
              <Field label="Type" className="w-48">
                <Select value={inner.type} onChange={(v) => onPatch({ inner_task: { ...inner, type: v as TaskType } })}
                  options={TASK_TYPES.filter((t) => !["for_each", "condition", "run_job", "pipeline"].includes(t.value))} />
              </Field>
            </div>
            {inner.type === "sql" && (
              <Textarea className="mono mt-2" rows={5} value={inner.sql}
                onChange={(e) => onPatch({ inner_task: { ...inner, sql: e.target.value } })}
                placeholder="INSERT INTO staging.by_country SELECT * FROM raw WHERE country = '{{input}}'" />
            )}
            {inner.type === "notebook" && (
              <Picker label="Notebook" value={inner.notebook_id ?? ""} onChange={(v) => onPatch({ inner_task: { ...inner, notebook_id: v } })}
                options={(notebooks.data ?? []).map((n) => ({ value: n.id, label: n.name }))} />
            )}
            {inner.type === "saved_query" && (
              <Picker label="Saved query" value={inner.query_id ?? ""} onChange={(v) => onPatch({ inner_task: { ...inner, query_id: v } })}
                options={(savedQueries.data ?? []).map((q) => ({ value: q.id, label: q.name }))} />
            )}
          </div>
        </div>
      )}

      {/* dependencies */}
      {upstream.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-medium" style={{ fontSize: 13 }}>Depends on</div>
          <div className="flex flex-col gap-1.5">
            {upstream.map((u) => {
              const dep = task.depends_on.find((d) => d.key === u.key);
              const isCond = u.type === "condition";
              return (
                <div key={u.key} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!dep} onChange={(e) => setDep(u.key, e.target.checked ? (isCond ? "true" : "success") : null)} />
                    <span className="mono">{u.name ?? u.key}</span>
                  </label>
                  {dep && (
                    <Select
                      className="w-40"
                      value={dep.outcome}
                      onChange={(v) => setDep(u.key, v as never)}
                      ariaLabel="Dependency outcome"
                      options={
                        isCond
                          ? [{ value: "true", label: "true branch" }, { value: "false", label: "false branch" }]
                          : [
                              { value: "success", label: "on success" },
                              { value: "failed", label: "on failure" },
                              { value: "done", label: "when done" },
                            ]
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
          <Field label="Run this task if" className="mt-2 max-w-xs">
            <Select value={task.run_if} onChange={(v) => onPatch({ run_if: v as RunIf })} options={RUN_IF} />
          </Field>
        </div>
      )}

      {/* retries + timeout + params */}
      {task.type !== "condition" && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Max retries"><Input type="number" min={0} value={task.retry.max_retries}
            onChange={(e) => onPatch({ retry: { ...task.retry, max_retries: Number(e.target.value) } })} /></Field>
          <Field label="Retry interval (ms)"><Input type="number" min={0} step={1000} value={task.retry.min_retry_interval_millis}
            onChange={(e) => onPatch({ retry: { ...task.retry, min_retry_interval_millis: Number(e.target.value) } })} /></Field>
          <Field label="Timeout (s, 0 = none)"><Input type="number" min={0} value={task.timeout_seconds}
            onChange={(e) => onPatch({ timeout_seconds: Number(e.target.value) })} /></Field>
          <label className="flex items-end gap-2 pb-2" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={task.retry.retry_on_timeout}
              onChange={(e) => onPatch({ retry: { ...task.retry, retry_on_timeout: e.target.checked } })} />
            Retry on timeout
          </label>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-medium" style={{ fontSize: 13 }}>Task parameters</span>
          <IconButton title="Add parameter" onClick={() => onPatch({ parameters: { ...task.parameters, [`param_${paramRows.length + 1}`]: "" } })}>
            <Plus size={13} />
          </IconButton>
        </div>
        {paramRows.map(([k, v]) => (
          <div key={k} className="mb-1.5 flex items-center gap-2">
            <Input className="mono w-48" defaultValue={k} onBlur={(e) => {
              const nk = e.target.value.trim();
              if (!nk || nk === k) return;
              const next = { ...task.parameters };
              delete next[k];
              next[nk] = v;
              onPatch({ parameters: next });
            }} />
            <Input className="mono flex-1" value={v} onChange={(e) => onPatch({ parameters: { ...task.parameters, [k]: e.target.value } })}
              placeholder="{{input}} or a literal" />
            <IconButton title="Remove" onClick={() => {
              const next = { ...task.parameters };
              delete next[k];
              onPatch({ parameters: next });
            }}><Trash2 size={13} /></IconButton>
          </div>
        ))}
      </div>

      <label className="mt-4 flex items-center gap-2" style={{ fontSize: 13 }}>
        <input type="checkbox" checked={task.disabled} onChange={(e) => onPatch({ disabled: e.target.checked })} />
        Disable this task (skipped, and treated as absent by dependents)
      </label>
    </div>
  );
}

const cond = (t: JobTask) => t.condition ?? { left: "", op: "==" as const, right: "" };
const forEach = (t: JobTask) => t.for_each ?? { inputs: "[]", concurrency: 1 };

function Picker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label} className="max-w-md">
      <Select value={value} onChange={onChange} options={[{ value: "", label: `Select a ${label.toLowerCase()}…` }, ...options]} />
    </Field>
  );
}

/* --------------------------------------------------------------- runs tab */

function RunsTab({ jobId, runs }: { jobId: string; runs: ReturnType<typeof useAsync<import("@/lib/types").JobRun[]>> }) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "matrix">("list");
  const matrix = useAsync(() => api.jobs.matrix(jobId, 24), [jobId]);
  useInterval(() => {
    if (view === "matrix") matrix.reload();
  }, 3000);

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {(["list", "matrix"] as const).map((v) => (
          <Button key={v} size="sm" variant={view === v ? "primary" : "default"} onClick={() => setView(v)}>
            {v === "list" ? "List" : "Matrix"}
          </Button>
        ))}
        <span className="ml-auto">
          <IconButton title="Refresh" onClick={() => (view === "list" ? runs.reload() : matrix.reload())}><RefreshCw size={13} /></IconButton>
        </span>
      </div>

      {view === "list" && (
        <div className="lh-card overflow-hidden">
          {runs.loading && <div className="p-3"><Skeleton style={{ height: 140 }} /></div>}
          {runs.data && (
            <DataTable
              dense
              rows={runs.data}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/job-runs/${row.id}`)}
              emptyMessage="This job has not run yet."
              columns={[
                { key: "n", header: "Run", width: 80, render: (row) => <span className="mono font-medium">#{row.run_number}{row.repair_count ? ` ·r${row.repair_count}` : ""}</span> },
                { key: "status", header: "Status", width: 120, render: (row) => <StatusBadge status={row.status} /> },
                { key: "trigger", header: "Trigger", width: 110, render: (row) => <Badge>{row.trigger}</Badge> },
                {
                  key: "tasks",
                  header: "Tasks",
                  render: (row) => (
                    <span className="flex flex-wrap items-center gap-1">
                      {row.task_runs.map((t) => (
                        <span key={t.key} title={`${t.name}: ${t.status}`} style={{ width: 8, height: 8, borderRadius: 2, background: statusColor(t.status) }} />
                      ))}
                    </span>
                  ),
                },
                { key: "duration", header: "Duration", align: "right", width: 100, render: (row) => formatDuration(row.duration_ms) },
                { key: "started", header: "Started", width: 170, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.started_at)}</span> },
              ]}
            />
          )}
        </div>
      )}

      {view === "matrix" && (
        <div className="lh-card overflow-x-auto p-3">
          {matrix.loading && <Skeleton style={{ height: 160 }} />}
          {matrix.data && matrix.data.runs.length === 0 && (
            <div className="py-8 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>No runs yet.</div>
          )}
          {matrix.data && matrix.data.runs.length > 0 && (
            <table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 12 }}>
              <thead>
                <tr>
                  <th className="text-left" style={{ padding: "0 8px", color: "var(--text-secondary)" }}>Task</th>
                  {matrix.data.runs.map((r) => (
                    <th key={r.id} title={`${formatDateTime(r.started_at)} · ${r.status}`}>
                      <Link href={`/job-runs/${r.id}`} className="mono" style={{ color: "var(--link)" }}>#{r.run_number}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.data.tasks.map((t) => (
                  <tr key={t.key}>
                    <td className="mono whitespace-nowrap" style={{ padding: "0 8px", color: "var(--text-primary)" }}>{t.name}</td>
                    {matrix.data!.runs.map((r) => {
                      const cell = r.cells[t.key];
                      return (
                        <td key={r.id}>
                          <span
                            title={cell ? `${cell.status} · ${formatDuration(cell.duration_ms)}` : "—"}
                            onClick={() => router.push(`/job-runs/${r.id}`)}
                            className="block cursor-pointer"
                            style={{ width: 22, height: 22, borderRadius: 4, background: cell ? statusColor(cell.status) : "var(--bg-tertiary)" }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- schedule tab */

function ScheduleTab({
  draft,
  onChange,
  onSave,
  saving,
}: {
  draft: Job;
  onChange: (patch: Partial<Job>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const s = draft.schedule;
  const kind = draft.continuous ? "continuous" : s?.kind ?? "none";
  const setSchedule = (schedule: Schedule | null) => onChange({ schedule, continuous: false });

  return (
    <div className="lh-card max-w-xl p-4">
      <Field label="Trigger">
        <Select
          value={kind}
          onChange={(v) => {
            if (v === "none") setSchedule(null);
            else if (v === "continuous") onChange({ continuous: true, schedule: null, paused: false });
            else if (v === "interval") setSchedule({ kind: "interval", every: 15, unit: "minutes" });
            else if (v === "daily") setSchedule({ kind: "daily", at: "03:00" });
            else setSchedule({ kind: "cron", cron: "0 * * * *", tz: "UTC" });
          }}
          options={[
            { value: "none", label: "Manual only" },
            { value: "interval", label: "Every N minutes / hours" },
            { value: "daily", label: "Daily at a fixed time" },
            { value: "cron", label: "Cron expression" },
            { value: "continuous", label: "Continuous (restart on completion)" },
          ]}
        />
      </Field>

      {s?.kind === "interval" && (
        <div className="mt-3 flex gap-2">
          <Field label="Every" className="w-28">
            <Input type="number" min={1} value={s.every ?? 15} onChange={(e) => setSchedule({ ...s, every: Number(e.target.value) })} />
          </Field>
          <Field label="Unit" className="w-40">
            <Select value={s.unit ?? "minutes"} onChange={(v) => setSchedule({ ...s, unit: v as "minutes" | "hours" })}
              options={[{ value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }]} />
          </Field>
        </div>
      )}

      {s?.kind === "daily" && (
        <Field label="Time (UTC)" className="mt-3 w-40">
          <Input type="time" value={s.at ?? "03:00"} onChange={(e) => setSchedule({ ...s, at: e.target.value })} />
        </Field>
      )}

      {s?.kind === "cron" && (
        <div className="mt-3 flex flex-col gap-2">
          <Field label="Quick presets">
            <Select value={s.cron ?? ""} onChange={(v) => setSchedule({ ...s, cron: v })}
              options={[{ value: s.cron ?? "", label: "Custom…" }, ...CRON_PRESETS.map((p) => ({ value: p.value, label: p.label }))]} />
          </Field>
          <div className="flex gap-2">
            <Field label="Expression (min hour dom month dow)" className="flex-1">
              <Input className="mono" value={s.cron ?? ""} onChange={(e) => setSchedule({ ...s, cron: e.target.value })} placeholder="0 3 * * 1-5" />
            </Field>
            <Field label="Timezone" className="w-52">
              <Input value={s.tz ?? "UTC"} onChange={(e) => setSchedule({ ...s, tz: e.target.value })} placeholder="America/New_York" />
            </Field>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{scheduleLabel(s)}</span>
        </div>
      )}

      {kind !== "none" && kind !== "continuous" && (
        <label className="mt-4 flex items-center gap-2" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={!draft.paused} onChange={(e) => onChange({ paused: !e.target.checked })} />
          Schedule active
        </label>
      )}

      <div className="mt-4">
        <Button variant="primary" onClick={onSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- parameters tab */

function ParametersTab({
  params,
  onChange,
  onSave,
  saving,
}: {
  params: Job["parameters"];
  onChange: (p: Job["parameters"]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="lh-card max-w-2xl p-4">
      <p className="mb-3" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Job parameters are available to every task as <span className="mono">{`{{job.parameters.<name>}}`}</span> (or the bare{" "}
        <span className="mono">{`{{<name>}}`}</span>). Their defaults can be overridden per run.
      </p>
      {params.map((p, i) => (
        <div key={i} className="mb-2 flex items-center gap-2">
          <Input className="mono w-56" value={p.name} onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="name" />
          <Input className="flex-1" value={p.default} onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, default: e.target.value } : x)))} placeholder="default value" />
          <IconButton title="Remove" onClick={() => onChange(params.filter((_, j) => j !== i))}><Trash2 size={13} /></IconButton>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange([...params, { name: `param_${params.length + 1}`, default: "" }])}>Add parameter</Button>
        <Button size="sm" variant="primary" onClick={onSave} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- notifications tab */

function NotificationsTab({
  jobId,
  settings,
  onChange,
  onSave,
  saving,
}: {
  jobId: string;
  settings: Job["notifications"];
  onChange: (s: Job["notifications"]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const toast = useToast();
  const log = useAsync(() => api.jobs.notificationLog(jobId, 30), [jobId]);
  const [testUrl, setTestUrl] = useState("");

  const renderList = (label: string, field: keyof Job["notifications"]) => {
    const urls = (settings[field] as string[]) ?? [];
    return (
      <Field label={label}>
        {urls.map((u, i) => (
          <div key={i} className="mb-1.5 flex gap-2">
            <Input className="mono flex-1" value={u} onChange={(e) => onChange({ ...settings, [field]: urls.map((x, j) => (j === i ? e.target.value : x)) })} placeholder="https://hooks.example.com/…" />
            <IconButton title="Remove" onClick={() => onChange({ ...settings, [field]: urls.filter((_, j) => j !== i) })}><Trash2 size={13} /></IconButton>
          </div>
        ))}
        <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange({ ...settings, [field]: [...urls, ""] })}>Add webhook</Button>
      </Field>
    );
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="lh-card flex flex-col gap-3 p-4">
        {renderList("On run start", "on_start")}
        {renderList("On success", "on_success")}
        {renderList("On failure", "on_failure")}
        {renderList("On long-running run", "on_duration_warning")}
        <Field label="Warn when a run exceeds (seconds, 0 = off)" className="w-64">
          <Input type="number" min={0} value={settings.min_duration_warning_seconds}
            onChange={(e) => onChange({ ...settings, min_duration_warning_seconds: Number(e.target.value) })} />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={onSave} loading={saving}>Save</Button>
          <Input className="mono flex-1" value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://… (test a webhook)" />
          <Button disabled={!testUrl} onClick={async () => {
            try {
              await api.jobs.testWebhook(jobId, testUrl);
              toast("Test webhook queued", "info");
              setTimeout(() => log.reload(), 800);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Failed", "danger");
            }
          }}>Send test</Button>
        </div>
      </div>

      <div className="lh-card overflow-hidden">
        <div className="px-3 py-2 font-medium" style={{ fontSize: 13, borderBottom: "1px solid var(--border)" }}>Delivery log</div>
        {log.data && (
          <DataTable
            dense
            rows={log.data}
            keyOf={(r) => r.id}
            emptyMessage="No webhooks delivered yet."
            columns={[
              { key: "when", header: "When", width: 170, render: (r) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(r.created_at)}</span> },
              { key: "event", header: "Event", width: 150, render: (r) => <Badge>{r.event}</Badge> },
              { key: "status", header: "Status", width: 90, render: (r) => <StatusBadge status={r.status} /> },
              { key: "url", header: "URL", render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.url}</span> },
              { key: "detail", header: "Detail", render: (r) => <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.detail}</span> },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- settings tab */

function SettingsTab({
  draft,
  onChange,
  onSave,
  saving,
  onDelete,
}: {
  draft: Job;
  onChange: (patch: Partial<Job>) => void;
  onSave: () => void;
  saving: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="lh-card flex flex-col gap-3 p-4">
        <Field label="Description">
          <Textarea rows={2} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
        <Field label="Tags (comma separated)">
          <Input value={draft.tags.join(", ")} onChange={(e) => onChange({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
        </Field>
        <div className="flex gap-2">
          <Field label="Max concurrent runs" className="w-44">
            <Input type="number" min={1} value={draft.max_concurrent_runs} onChange={(e) => onChange({ max_concurrent_runs: Number(e.target.value) })} />
          </Field>
          <Field label="Job timeout (s, 0 = none)" className="w-48">
            <Input type="number" min={0} value={draft.timeout_seconds} onChange={(e) => onChange({ timeout_seconds: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={draft.queue_enabled} onChange={(e) => onChange({ queue_enabled: e.target.checked })} />
          Queue runs that exceed the concurrency limit (instead of dropping them)
        </label>
        <div>
          <Button variant="primary" onClick={onSave} loading={saving}>Save</Button>
        </div>
      </div>

      <div className="lh-card p-4" style={{ borderColor: "var(--border-danger)" }}>
        <div className="mb-2 font-medium" style={{ fontSize: 13, color: "var(--text-danger)" }}>Danger zone</div>
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={onDelete}>Delete job</Button>
      </div>
    </div>
  );
}
