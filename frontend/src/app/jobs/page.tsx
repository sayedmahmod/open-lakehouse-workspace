"use client";

import { Pause, Play, Plus, Trash2, Workflow } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import {
  Badge, Button, DataTable, EmptyState, ErrorBanner, Field, IconButton, Input, Modal, Select,
  SearchInput, Skeleton, Spinner, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration, formatRelative, statusColor } from "@/lib/format";
import { scheduleLabel } from "@/lib/schedule";
import type { TaskType } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

function RunSparkline({ statuses }: { statuses: string[] }) {
  if (!statuses.length) return <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>—</span>;
  return (
    <span className="inline-flex items-end gap-[3px]" title={statuses.join(" · ")}>
      {statuses.map((s, i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 14,
            borderRadius: 1,
            background: statusColor(s),
            opacity: i === statuses.length - 1 ? 1 : 0.7,
          }}
        />
      ))}
    </span>
  );
}

function JobsInner() {
  const jobs = useAsync(() => api.jobs.list(), []);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("all");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [firstType, setFirstType] = useState<TaskType>("sql");
  const [sqlText, setSqlText] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  useEffect(() => {
    if (params.get("new") === "1") setCreating(true);
  }, [params]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (jobs.data ?? []).forEach((j) => j.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [jobs.data]);

  const rows = (jobs.data ?? []).filter(
    (j) =>
      j.name.toLowerCase().includes(search.toLowerCase()) &&
      (tag === "all" || j.tags.includes(tag)),
  );

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const job = await api.jobs.create({
        name: name.trim(),
        tasks: [
          {
            key: "task_1",
            name: "task_1",
            type: firstType,
            sql: firstType === "sql" ? sqlText : "",
            depends_on: [],
            run_if: "ALL_SUCCESS",
            retry: { max_retries: 0, min_retry_interval_millis: 0, retry_on_timeout: false },
            timeout_seconds: 0,
            parameters: {},
            capture_output: false,
            disabled: false,
          },
        ],
        paused: true,
      });
      toast(`Job “${job.name}” created`, "success");
      setCreating(false);
      setName("");
      setSqlText("");
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create job", "danger");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      const run = await api.jobs.run(id);
      toast(`Run #${run.run_number} started`, "info");
      router.push(`/job-runs/${run.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Run failed", "danger");
    } finally {
      setRunningId(null);
    }
  };

  const togglePause = async (id: string, paused: boolean) => {
    try {
      await api.jobs.update(id, { paused: !paused });
      jobs.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update", "danger");
    }
  };

  const remove = async (id: string, jobName: string) => {
    if (!confirm(`Delete job “${jobName}” and its run history?`)) return;
    try {
      await api.jobs.remove(id);
      toast("Job deleted", "success");
      jobs.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "danger");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Jobs & Pipelines"
        description="Multi-task workflows — a task DAG that runs SQL, notebooks, conditions, loops and pipelines on a schedule"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create job
          </Button>
        }
      />

      <div className="px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter jobs" className="max-w-xs" />
          {allTags.length > 0 && (
            <Select
              value={tag}
              onChange={setTag}
              ariaLabel="Filter by tag"
              className="w-44"
              options={[{ value: "all", label: "All tags" }, ...allTags.map((t) => ({ value: t, label: t }))]}
            />
          )}
        </div>

        {jobs.loading && <Skeleton style={{ height: 180 }} />}
        {jobs.error && <ErrorBanner message={jobs.error} onRetry={jobs.reload} />}

        {jobs.data && jobs.data.length === 0 && (
          <EmptyState
            icon={<Workflow size={28} />}
            title="No jobs yet"
            description="A job chains SQL, notebook, condition and for-each tasks into a dependency graph, and can run on a schedule."
            action={<Button variant="primary" onClick={() => setCreating(true)}>Create job</Button>}
          />
        )}

        {jobs.data && jobs.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={rows}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/jobs/${row.id}`)}
              emptyMessage="No jobs match the filter."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{row.name}</span>
                      {row.tags.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {row.tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </span>
                      )}
                    </span>
                  ),
                },
                { key: "tasks", header: "Tasks", align: "right", width: 64, render: (row) => row.tasks.length },
                { key: "spark", header: "Recent runs", width: 110, render: (row) => <RunSparkline statuses={row.recent_statuses ?? []} /> },
                {
                  key: "schedule",
                  header: "Schedule",
                  width: 170,
                  render: (row) => (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {row.continuous ? "Continuous" : row.schedule ? scheduleLabel(row.schedule) : "Manual only"}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Last run",
                  width: 120,
                  render: (row) =>
                    row.last_run ? <StatusBadge status={row.last_run.status} /> : <span style={{ color: "var(--text-secondary)" }}>Never</span>,
                },
                {
                  key: "when",
                  header: "",
                  width: 150,
                  render: (row) => (
                    <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                      {row.last_run
                        ? `${formatRelative(row.last_run.started_at)} · ${formatDuration(row.last_run.duration_ms)}`
                        : row.next_run_at
                          ? `next ${formatRelative(row.next_run_at)}`
                          : ""}
                    </span>
                  ),
                },
                {
                  key: "state",
                  header: "State",
                  width: 96,
                  render: (row) => (
                    <Badge tone={row.paused ? "neutral" : "success"}>{row.paused ? "Paused" : "Active"}</Badge>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  width: 110,
                  render: (row) => (
                    <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <IconButton title="Run now" disabled={runningId === row.id} onClick={() => runNow(row.id)}>
                        {runningId === row.id ? <Spinner size={13} /> : <Play size={13} />}
                      </IconButton>
                      <IconButton
                        title={row.paused ? "Resume schedule" : "Pause schedule"}
                        onClick={() => togglePause(row.id, row.paused)}
                        disabled={!row.schedule && !row.continuous}
                      >
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
        title="Create job"
        width={640}
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
          <Field label="Job name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly gold refresh" autoFocus />
          </Field>
          <Field label="First task type">
            <Select
              value={firstType}
              onChange={(v) => setFirstType(v as TaskType)}
              options={[
                { value: "sql", label: "SQL" },
                { value: "notebook", label: "Notebook" },
                { value: "saved_query", label: "Saved query" },
                { value: "dashboard", label: "Dashboard refresh" },
                { value: "condition", label: "Condition (if/else)" },
                { value: "for_each", label: "For each" },
                { value: "run_job", label: "Run job" },
                { value: "pipeline", label: "Pipeline" },
              ]}
            />
          </Field>
          {firstType === "sql" && (
            <Field label="SQL" hint="You can add more tasks, dependencies, retries and a schedule after the job is created.">
              <Textarea
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                rows={6}
                className="mono"
                placeholder="INSERT INTO unity.gold.daily_orders SELECT ..."
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <JobsInner />
    </Suspense>
  );
}
