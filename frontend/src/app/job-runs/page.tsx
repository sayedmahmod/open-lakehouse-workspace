"use client";

import { PlayCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, EmptyState, ErrorBanner, Select, Skeleton, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, statusColor } from "@/lib/format";
import { useAsync, useInterval } from "@/lib/useAsync";

export default function JobRunsPage() {
  const [status, setStatus] = useState("all");
  const [jobId, setJobId] = useState("all");
  const jobs = useAsync(() => api.jobs.list(), []);
  const runs = useAsync(
    () => api.jobs.allRuns(150, status, jobId === "all" ? undefined : jobId),
    [status, jobId],
  );
  const router = useRouter();

  useInterval(() => {
    if ((runs.data ?? []).some((r) => r.status === "RUNNING" || r.status === "QUEUED")) runs.reload();
  }, 2500);

  const jobOptions = useMemo(
    () => [{ value: "all", label: "All jobs" }, ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.name }))],
    [jobs.data],
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Job Runs"
        description="Every execution across all jobs, newest first"
        actions={
          <Button icon={<RefreshCw size={14} />} onClick={runs.reload}>
            Refresh
          </Button>
        }
      />

      <div className="px-6">
        <div className="mb-3 flex flex-wrap gap-2">
          <Select
            value={status}
            onChange={setStatus}
            ariaLabel="Filter by status"
            className="w-48"
            options={[
              { value: "all", label: "All statuses" },
              { value: "success", label: "Success" },
              { value: "failed", label: "Failed" },
              { value: "running", label: "Running" },
              { value: "canceled", label: "Canceled" },
              { value: "queued", label: "Queued" },
            ]}
          />
          <Select value={jobId} onChange={setJobId} ariaLabel="Filter by job" className="w-56" options={jobOptions} />
        </div>

        {runs.loading && !runs.data && <Skeleton style={{ height: 200 }} />}
        {runs.error && <ErrorBanner message={runs.error} onRetry={runs.reload} />}

        {runs.data && runs.data.length === 0 && (
          <EmptyState icon={<PlayCircle size={28} />} title="No runs yet" description="Trigger a job and its runs appear here." />
        )}

        {runs.data && runs.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              dense
              rows={runs.data}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(`/job-runs/${row.id}`)}
              columns={[
                {
                  key: "job",
                  header: "Job",
                  render: (row) => (
                    <Link href={`/jobs/${row.job_id}`} onClick={(e) => e.stopPropagation()} className="font-medium">
                      {row.job_name}
                    </Link>
                  ),
                },
                { key: "n", header: "Run", width: 80, render: (row) => <span className="mono">#{row.run_number}{row.repair_count ? ` ·r${row.repair_count}` : ""}</span> },
                { key: "status", header: "Status", width: 120, render: (row) => <StatusBadge status={row.status} /> },
                { key: "trigger", header: "Trigger", width: 110, render: (row) => <Badge>{row.trigger}</Badge> },
                {
                  key: "tasks",
                  header: "Tasks",
                  render: (row) => (
                    <span className="flex flex-wrap items-center gap-1">
                      {row.task_runs.map((t) => (
                        <span
                          key={t.key}
                          title={`${t.name}: ${t.status}`}
                          style={{ width: 8, height: 8, borderRadius: 2, background: statusColor(t.status) }}
                        />
                      ))}
                    </span>
                  ),
                },
                { key: "duration", header: "Duration", align: "right", width: 100, render: (row) => formatDuration(row.duration_ms) },
                { key: "started", header: "Started", width: 170, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.started_at)}</span> },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
