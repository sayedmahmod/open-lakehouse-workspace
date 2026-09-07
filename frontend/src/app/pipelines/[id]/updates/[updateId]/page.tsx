"use client";

import { RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useMemo, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, ErrorBanner, Skeleton, StatusBadge, Tabs, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration, formatNumber, statusColor } from "@/lib/format";
import type { DatasetResult, ExpectationResult } from "@/lib/types";
import { useAsync, useInterval } from "@/lib/useAsync";

const EVENT_COLOR: Record<string, string> = {
  INFO: "var(--text-secondary)",
  WARN: "var(--text-warning)",
  ERROR: "var(--text-danger)",
};

function qualitySummary(exps: ExpectationResult[]): { failed: number; dropped: number; warned: number; ok: boolean } {
  let failed = 0;
  let dropped = 0;
  let warned = 0;
  for (const e of exps) {
    const bad = e.failed ?? 0;
    if (!bad) continue;
    if (e.action === "fail") failed += bad;
    else if (e.action === "drop") dropped += bad;
    else warned += bad;
  }
  return { failed, dropped, warned, ok: failed === 0 && dropped === 0 && warned === 0 };
}

export default function PipelineUpdateDetailPage() {
  const { id, updateId } = useParams<{ id: string; updateId: string }>();
  const toast = useToast();
  const update = useAsync(() => api.pipelines.updateDetail(updateId), [updateId]);
  const [tab, setTab] = useState("datasets");
  const [busy, setBusy] = useState(false);

  const data = update.data;
  const active = data?.status === "RUNNING" || data?.status === "QUEUED";

  useInterval(() => {
    if (active) update.reload();
  }, 2000);

  const stop = async () => {
    setBusy(true);
    try {
      await api.pipelines.stopUpdate(updateId);
      toast("Stopping update…", "info");
      update.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not stop update", "danger");
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const ds = data?.datasets ?? [];
    return {
      total: ds.length,
      done: ds.filter((d) => d.status === "COMPLETED").length,
      failed: ds.filter((d) => d.status === "FAILED").length,
      rows: ds.reduce((n, d) => n + (d.rows_written ?? d.rows ?? 0), 0),
    };
  }, [data]);

  return (
    <div className="pb-10">
      <PageHeader
        title={data ? `Update #${data.update_number}` : "Update"}
        breadcrumbs={[
          { label: "Pipelines", href: "/pipelines" },
          ...(data ? [{ label: data.pipeline_name ?? "Pipeline", href: `/pipelines/${data.pipeline_id ?? id}` }] : []),
        ]}
        description={
          data ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.status} />
              <Badge>{data.cause}</Badge>
              {data.full_refresh && <Badge tone="warning">Full refresh</Badge>}
              {!data.full_refresh && data.refresh_selection.length > 0 && (
                <Badge tone="info">Scoped: {data.refresh_selection.join(", ")}</Badge>
              )}
              <Badge tone={data.development ? "info" : "neutral"}>{data.development ? "Development" : "Production"}</Badge>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {formatDateTime(data.started_at)} · {formatDuration(data.duration_ms)}
              </span>
            </span>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button icon={<RefreshCw size={14} />} onClick={update.reload}>
              Refresh
            </Button>
            {active && (
              <Button variant="danger" icon={<Square size={14} />} loading={busy} onClick={stop}>
                Stop
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6">
        {update.loading && !data && <Skeleton style={{ height: 240 }} />}
        {update.error && <ErrorBanner message={update.error} onRetry={update.reload} />}

        {data && (
          <>
            {data.error && (
              <div
                className="mb-4 rounded-[6px] px-3 py-2"
                style={{ background: "var(--background-danger-subtle, rgba(220,38,38,0.08))", border: "1px solid var(--border-danger, rgba(220,38,38,0.4))" }}
              >
                <pre className="mono whitespace-pre-wrap" style={{ fontSize: 12, color: "var(--text-danger)" }}>
                  {data.error}
                </pre>
              </div>
            )}

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Datasets", value: formatNumber(counts.total) },
                { label: "Completed", value: formatNumber(counts.done) },
                { label: "Failed", value: formatNumber(counts.failed) },
                { label: "Rows written", value: formatNumber(counts.rows) },
              ].map((s) => (
                <div key={s.label} className="lh-card px-3 py-2">
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{s.value}</div>
                </div>
              ))}
            </div>

            <Tabs
              active={tab}
              onChange={setTab}
              className="mb-3"
              tabs={[
                { id: "datasets", label: "Datasets", count: counts.total },
                { id: "events", label: "Event log", count: data.events.length },
              ]}
            />

            {tab === "datasets" && (
              <div className="flex flex-col gap-2">
                {data.datasets.length === 0 && (
                  <div className="lh-card px-4 py-10 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    No datasets were processed in this update.
                  </div>
                )}
                {data.datasets.map((row: DatasetResult) => (
                  <DatasetCard key={row.name} row={row} pipelineHref={`/pipelines/${data.pipeline_id ?? id}`} />
                ))}
              </div>
            )}

            {tab === "events" && (
              <div className="lh-card mt-3 overflow-hidden">
                {data.events.length === 0 ? (
                  <div className="px-3 py-6 text-center" style={{ color: "var(--text-secondary)" }}>
                    No events recorded.
                  </div>
                ) : (
                  <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                    {data.events.map((ev, i) => (
                      <li key={i} className="flex items-start gap-3 px-3 py-1.5" style={{ fontSize: 12 }}>
                        <span className="mono shrink-0" style={{ color: "var(--text-secondary)" }}>
                          {formatDateTime(ev.ts)}
                        </span>
                        <span
                          className="mono shrink-0"
                          style={{ width: 46, fontWeight: 600, color: EVENT_COLOR[ev.level] ?? "var(--text-secondary)" }}
                        >
                          {ev.level}
                        </span>
                        {ev.dataset && (
                          <span className="mono shrink-0" style={{ color: "var(--text-link)" }}>
                            {ev.dataset}
                          </span>
                        )}
                        <span className="whitespace-pre-wrap">{ev.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DatasetCard({ row, pipelineHref }: { row: DatasetResult; pipelineHref: string }) {
  const [open, setOpen] = useState(false);
  const q = qualitySummary(row.expectations);
  const hasDetail = !!row.error || row.expectations.length > 0;

  return (
    <div className="lh-card overflow-hidden">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: statusColor(row.status), flexShrink: 0 }} />
        <Link href={pipelineHref} className="mono font-medium" onClick={(e) => e.stopPropagation()}>
          {row.name}
        </Link>
        <Badge>{row.type.replace(/_/g, " ")}</Badge>
        <StatusBadge status={row.status} />
        <span className="ml-auto flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {(row.rows_written != null || row.rows != null) && (
            <span className="mono">{formatNumber(row.rows_written ?? row.rows ?? 0)} rows</span>
          )}
          {row.expectations.length > 0 &&
            (q.ok ? (
              <Badge tone="success">{row.expectations.length} passed</Badge>
            ) : (
              <span className="flex gap-1">
                {q.failed > 0 && <Badge tone="danger">{formatNumber(q.failed)} failed</Badge>}
                {q.dropped > 0 && <Badge tone="warning">{formatNumber(q.dropped)} dropped</Badge>}
                {q.warned > 0 && <Badge tone="info">{formatNumber(q.warned)} warned</Badge>}
              </span>
            ))}
          <span>{formatDuration(row.duration_ms)}</span>
        </span>
      </button>

      {open && hasDetail && (
        <div className="flex flex-col gap-3 border-t px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
          {row.error && (
            <pre className="mono whitespace-pre-wrap" style={{ fontSize: 12, color: "var(--text-danger)" }}>
              {row.error}
            </pre>
          )}
          {row.expectations.length > 0 && (
            <table className="w-full" style={{ fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--text-secondary)", textAlign: "left" }}>
                  <th className="py-1">Expectation</th>
                  <th className="py-1">Condition</th>
                  <th className="py-1">Action</th>
                  <th className="py-1 text-right">Failed / Total</th>
                </tr>
              </thead>
              <tbody>
                {row.expectations.map((e) => (
                  <tr key={e.name} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td className="py-1 font-medium">{e.name}</td>
                    <td className="py-1">
                      <code className="mono">{e.condition}</code>
                    </td>
                    <td className="py-1">
                      <Badge tone={e.action === "fail" ? "danger" : e.action === "drop" ? "warning" : "info"}>
                        {e.action}
                      </Badge>
                    </td>
                    <td className="mono py-1 text-right">
                      {e.error ? (
                        <span style={{ color: "var(--text-danger)" }}>error</span>
                      ) : (
                        <span style={{ color: (e.failed ?? 0) > 0 ? "var(--text-danger)" : "var(--text-success)" }}>
                          {formatNumber(e.failed ?? 0)} / {formatNumber(e.total ?? 0)}
                        </span>
                      )}
                    </td>
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
