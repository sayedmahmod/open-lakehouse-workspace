"use client";

import { ExternalLink, RefreshCw, Server } from "lucide-react";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, EmptyState, ErrorBanner, Skeleton, StatusBadge, Tabs, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatBytes, formatDuration, formatMB, formatNumber, formatRelative } from "@/lib/format";
import { useAsync, useInterval } from "@/lib/useAsync";

function Meter({ label, used, total, unit }: { label: string; used: number; total: number; unit: (v: number) => string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between" style={{ fontSize: 12 }}>
        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ color: "var(--text-primary)" }}>
          {unit(used)} <span style={{ color: "var(--text-secondary)" }}>/ {unit(total)}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--progress-track)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--progress-fill)" }} />
      </div>
    </div>
  );
}

export default function ComputePage() {
  const [tab, setTab] = useState("overview");
  const cluster = useAsync(() => api.compute.cluster(), []);
  const executors = useAsync(() => (tab === "executors" ? api.compute.executors() : Promise.resolve([])), [tab]);
  const sparkJobs = useAsync(() => (tab === "spark-jobs" ? api.compute.sparkJobs(60) : Promise.resolve([])), [tab]);
  const config = useAsync(() => api.config(), []);
  const toast = useToast();
  const [restarting, setRestarting] = useState(false);

  useInterval(() => cluster.reload(), 10000);

  const restart = async () => {
    setRestarting(true);
    try {
      const result = await api.compute.restartSession();
      toast(result.reachable ? `Spark Connect session rebuilt (${result.version})` : "Session restart failed", result.reachable ? "success" : "danger");
      cluster.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Restart failed", "danger");
    } finally {
      setRestarting(false);
    }
  };

  const master = cluster.data?.master;

  return (
    <div className="pb-10">
      <PageHeader
        title="Compute"
        description="The Spark standalone cluster and the Spark Connect session behind every query"
        actions={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={cluster.reload}>
              Refresh
            </Button>
            <Button variant="primary" onClick={restart} loading={restarting}>
              Restart session
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
            { id: "overview", label: "Overview" },
            { id: "workers", label: "Workers", count: master?.workers.length },
            { id: "executors", label: "Executors" },
            { id: "spark-jobs", label: "Spark Jobs" },
            { id: "config", label: "Configuration" },
          ]}
        />

        {cluster.loading && !cluster.data && <Skeleton style={{ height: 200 }} />}
        {cluster.error && <ErrorBanner message={cluster.error} onRetry={cluster.reload} />}

        {tab === "overview" && cluster.data && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="lh-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold" style={{ fontSize: 13 }}>
                    Spark Connect
                  </span>
                  <Badge tone={cluster.data.connect.reachable ? "success" : "danger"}>
                    {cluster.data.connect.reachable ? "Connected" : "Unreachable"}
                  </Badge>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {cluster.data.connect.remote}
                </div>
                {cluster.data.connect.version && (
                  <div className="mt-1" style={{ fontSize: 12 }}>
                    Apache Spark {cluster.data.connect.version}
                  </div>
                )}
                {cluster.data.connect.error && (
                  <div className="mt-1" style={{ fontSize: 12, color: "var(--text-danger)" }}>
                    {cluster.data.connect.error}
                  </div>
                )}
              </div>

              <div className="lh-card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold" style={{ fontSize: 13 }}>
                    Cluster
                  </span>
                  <Badge tone={master?.reachable ? "success" : "danger"}>{master?.status ?? "Unknown"}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  <Meter label="Cores in use" used={master?.cores_used ?? 0} total={master?.cores_total ?? 0} unit={(v) => formatNumber(v)} />
                  <Meter label="Memory in use" used={master?.memory_used_mb ?? 0} total={master?.memory_total_mb ?? 0} unit={formatMB} />
                </div>
              </div>

              <div className="lh-card p-4">
                <div className="mb-2 font-semibold" style={{ fontSize: 13 }}>
                  Spark UIs
                </div>
                <div className="flex flex-col gap-1.5">
                  {cluster.data.links &&
                    Object.entries({
                      "Master UI": cluster.data.links.master_ui,
                      "Worker UI": cluster.data.links.worker_ui,
                      "Driver UI": cluster.data.links.driver_ui,
                    }).map(([label, href]) => (
                      <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5" style={{ fontSize: 12 }}>
                        {label} <ExternalLink size={11} />
                      </a>
                    ))}
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
                Applications
              </h2>
              <div className="lh-card overflow-hidden">
                <DataTable
                  dense
                  rows={[...(master?.active_apps ?? []), ...(master?.completed_apps ?? [])]}
                  keyOf={(row, i) => row.id ?? String(i)}
                  emptyMessage="No applications registered with the master."
                  columns={[
                    { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                    { key: "state", header: "State", width: 110, render: (row) => <StatusBadge status={row.state} /> },
                    { key: "cores", header: "Cores", align: "right", width: 80, render: (row) => formatNumber(row.cores) },
                    { key: "mem", header: "Memory/executor", align: "right", width: 140, render: (row) => formatMB(row.memory_per_executor_mb) },
                    { key: "user", header: "User", width: 140, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.user ?? "—"}</span> },
                    { key: "submitted", header: "Submitted", width: 150, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.submitted_at)}</span> },
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "workers" && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={master?.workers ?? []}
              keyOf={(row) => row.id}
              emptyMessage="No workers registered."
              columns={[
                { key: "id", header: "Worker", render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.id}</span> },
                { key: "state", header: "State", width: 100, render: (row) => <StatusBadge status={row.state} /> },
                { key: "host", header: "Host", width: 160, render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.host}:{row.port}</span> },
                { key: "cores", header: "Cores", align: "right", width: 120, render: (row) => `${row.cores_used} / ${row.cores}` },
                { key: "mem", header: "Memory", align: "right", width: 160, render: (row) => `${formatMB(row.memory_used_mb)} / ${formatMB(row.memory_mb)}` },
                { key: "hb", header: "Last heartbeat", width: 160, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.last_heartbeat)}</span> },
              ]}
            />
          </div>
        )}

        {tab === "executors" && (
          <div className="lh-card overflow-hidden">
            {executors.loading && <div className="p-3"><Skeleton style={{ height: 140 }} /></div>}
            {executors.data && (
              <DataTable
                dense
                rows={executors.data}
                keyOf={(row) => row.id}
                emptyMessage="The Spark Connect driver reported no executors. Its application UI may not be exposed on this host."
                columns={[
                  { key: "id", header: "Executor", width: 110, render: (row) => <span className="mono font-medium">{row.id}</span> },
                  { key: "host", header: "Host", render: (row) => <span className="mono" style={{ fontSize: 12 }}>{row.host_port}</span> },
                  { key: "active", header: "Active", width: 90, render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Removed"}</Badge> },
                  { key: "cores", header: "Cores", align: "right", width: 80, render: (row) => formatNumber(row.total_cores) },
                  { key: "tasks", header: "Tasks (done/failed)", align: "right", width: 150, render: (row) => `${formatNumber(row.completed_tasks)} / ${formatNumber(row.failed_tasks)}` },
                  { key: "mem", header: "Memory used", align: "right", width: 130, render: (row) => formatBytes(row.memory_used) },
                  { key: "input", header: "Input", align: "right", width: 110, render: (row) => formatBytes(row.total_input_bytes) },
                  { key: "shuffle", header: "Shuffle r/w", align: "right", width: 150, render: (row) => `${formatBytes(row.total_shuffle_read)} / ${formatBytes(row.total_shuffle_write)}` },
                ]}
              />
            )}
          </div>
        )}

        {tab === "spark-jobs" && (
          <div className="lh-card overflow-hidden">
            {sparkJobs.loading && <div className="p-3"><Skeleton style={{ height: 140 }} /></div>}
            {sparkJobs.data && (
              <DataTable
                dense
                rows={sparkJobs.data}
                keyOf={(row) => String(row.job_id)}
                emptyMessage="No Spark jobs reported. The driver UI for the Connect server is not reachable on this host."
                columns={[
                  { key: "id", header: "Job", width: 70, render: (row) => <span className="mono font-medium">{row.job_id}</span> },
                  { key: "name", header: "Description", render: (row) => <span className="truncate" style={{ fontSize: 12 }}>{row.name}</span> },
                  { key: "status", header: "Status", width: 110, render: (row) => <StatusBadge status={row.status} /> },
                  { key: "tasks", header: "Tasks", align: "right", width: 130, render: (row) => `${row.completed_tasks} / ${row.num_tasks}` },
                  { key: "failed", header: "Failed", align: "right", width: 80, render: (row) => formatNumber(row.failed_tasks) },
                  { key: "submitted", header: "Submitted", width: 160, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.submitted_at)}</span> },
                ]}
              />
            )}
          </div>
        )}

        {tab === "config" && config.data && (
          <div className="lh-card p-4">
            <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
              Connection settings
            </h2>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(config.data).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt style={{ fontSize: 12, color: "var(--text-secondary)" }}>{key.replace(/_/g, " ")}</dt>
                  <dd className="mono truncate" style={{ fontSize: 12 }} title={String(value)}>
                    {String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
