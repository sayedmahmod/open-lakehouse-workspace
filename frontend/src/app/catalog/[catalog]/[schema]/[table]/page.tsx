"use client";

import { ArrowRight, Check, Pencil, Table2, Terminal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ResultTable } from "@/components/charts/Chart";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorBanner,
  IconButton,
  Input,
  Skeleton,
  Tabs,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatBytes, formatCell, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { QueryResult } from "@/lib/types";

/** Turn a single-row DESCRIBE DETAIL result into a name → value map. */
function rowToRecord(result: QueryResult | null): Record<string, unknown> {
  if (!result || result.rows.length === 0) return {};
  const out: Record<string, unknown> = {};
  result.columns.forEach((col, i) => {
    out[col.name] = result.rows[0][i];
  });
  return out;
}

export default function TablePage() {
  const params = useParams<{ catalog: string; schema: string; table: string }>();
  const catalog = decodeURIComponent(params.catalog);
  const schema = decodeURIComponent(params.schema);
  const table = decodeURIComponent(params.table);
  const fullName = `${catalog}.${schema}.${table}`;
  const router = useRouter();
  const toast = useToast();

  const [tab, setTab] = useState("overview");
  const meta = useAsync(() => api.catalog.table(fullName), [fullName]);
  const [editingComment, setEditingComment] = useState(false);
  const [comment, setComment] = useState("");

  // Tab payloads load lazily, so opening the page costs one Unity Catalog call.
  const sample = useAsync(
    () => (tab === "sample" ? api.catalog.sample(fullName, 200) : Promise.resolve(null)),
    [tab, fullName],
  );
  const history = useAsync(
    () => (tab === "history" ? api.catalog.history(fullName, 100) : Promise.resolve(null)),
    [tab, fullName],
  );
  const detail = useAsync(
    () => (tab === "details" ? api.catalog.detail(fullName) : Promise.resolve(null)),
    [tab, fullName],
  );
  const profile = useAsync(
    () => (tab === "insights" ? api.catalog.profile(fullName) : Promise.resolve(null)),
    [tab, fullName],
  );
  const lineage = useAsync(
    () => (tab === "lineage" ? api.lineage.table(fullName) : Promise.resolve(null)),
    [tab, fullName],
  );

  useEffect(() => {
    if (meta.data) setComment(meta.data.comment ?? "");
  }, [meta.data]);

  // Record the visit so the table shows up under Recents.
  useEffect(() => {
    api.workspace
      .trackRecent({
        kind: "table",
        object_id: fullName,
        name: fullName,
        href: `/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
      })
      .catch(() => {});
  }, [fullName, catalog, schema, table]);

  const saveComment = async () => {
    try {
      await api.catalog.setTableComment(fullName, comment);
      setEditingComment(false);
      meta.reload();
      toast("Comment saved", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save comment", "danger");
    }
  };

  const dropTable = async () => {
    if (!confirm(`Drop table ${fullName}? This removes it from Unity Catalog.`)) return;
    try {
      await api.catalog.dropTable(fullName);
      toast(`Dropped ${fullName}`, "success");
      router.push(`/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not drop table", "danger");
    }
  };

  const t = meta.data;
  const detailRecord = rowToRecord(detail.data);

  return (
    <div className="pb-10">
      <PageHeader
        icon={<Table2 size={18} style={{ color: "var(--action-icon-default)" }} />}
        title={table}
        breadcrumbs={[
          { label: "Catalog", href: "/catalog" },
          { label: catalog, href: `/catalog/${encodeURIComponent(catalog)}` },
          { label: schema, href: `/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}` },
          { label: table },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono">{fullName}</span>
            {t?.table_type && <Badge>{t.table_type}</Badge>}
            {t?.data_source_format && <Badge tone="info">{t.data_source_format}</Badge>}
          </span>
        }
        actions={
          <>
            <Button
              icon={<Terminal size={14} />}
              onClick={() => router.push(`/sql-editor?sql=${encodeURIComponent(`SELECT * FROM ${fullName} LIMIT 100`)}`)}
            >
              Query
            </Button>
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={dropTable}>
              Drop
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
            { id: "sample", label: "Sample Data" },
            { id: "details", label: "Details" },
            { id: "history", label: "History" },
            { id: "lineage", label: "Lineage" },
            { id: "insights", label: "Insights" },
          ]}
        />

        {meta.loading && <Skeleton style={{ height: 240 }} />}
        {meta.error && <ErrorBanner message={meta.error} onRetry={meta.reload} />}

        {/* ------------------------------------------------------- Overview */}
        {tab === "overview" && t && (
          <div className="flex flex-col gap-4">
            <div className="lh-card p-3">
              <div className="mb-1 font-medium" style={{ fontSize: 13 }}>
                Comment
              </div>
              {editingComment ? (
                <div className="flex items-center gap-2">
                  <Input value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
                  <IconButton title="Save" onClick={saveComment}>
                    <Check size={15} />
                  </IconButton>
                  <IconButton
                    title="Cancel"
                    onClick={() => {
                      setComment(t.comment ?? "");
                      setEditingComment(false);
                    }}
                  >
                    <X size={15} />
                  </IconButton>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13, color: t.comment ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {t.comment || "No comment yet."}
                  </span>
                  <IconButton title="Edit comment" onClick={() => setEditingComment(true)}>
                    <Pencil size={13} />
                  </IconButton>
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
                Columns
              </h2>
              <div className="lh-card overflow-hidden">
                <DataTable
                  dense
                  rows={t.columns ?? []}
                  keyOf={(row) => row.name}
                  emptyMessage="This table has no column metadata in Unity Catalog."
                  columns={[
                    { key: "name", header: "Column", render: (row) => <span className="mono font-medium">{row.name}</span> },
                    {
                      key: "type",
                      header: "Type",
                      width: 160,
                      render: (row) => (
                        <span className="mono" style={{ color: "var(--link)" }}>
                          {row.type_text ?? row.type_name}
                        </span>
                      ),
                    },
                    {
                      key: "nullable",
                      header: "Nullable",
                      width: 90,
                      render: (row) => (row.nullable === false ? <Badge tone="warning">NOT NULL</Badge> : <span style={{ color: "var(--text-secondary)" }}>yes</span>),
                    },
                    {
                      key: "partition",
                      header: "Partition",
                      width: 90,
                      render: (row) =>
                        row.partition_index !== null && row.partition_index !== undefined ? (
                          <Badge tone="info">key {row.partition_index}</Badge>
                        ) : (
                          <span style={{ color: "var(--text-secondary)" }}>—</span>
                        ),
                    },
                    {
                      key: "comment",
                      header: "Comment",
                      render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.comment || "—"}</span>,
                    },
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- Sample Data */}
        {tab === "sample" && (
          <div className="lh-card overflow-hidden">
            {sample.loading && <div className="p-3"><Skeleton style={{ height: 220 }} /></div>}
            {sample.error && <div className="p-3"><ErrorBanner message={sample.error} onRetry={sample.reload} /></div>}
            {sample.data && (
              <>
                <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-secondary)" }}>
                  {formatNumber(sample.data.row_count)} rows sampled with{" "}
                  <span className="mono">SELECT * FROM {fullName} LIMIT 200</span>
                </div>
                <ResultTable columns={sample.data.columns} rows={sample.data.rows} maxHeight={520} />
              </>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- Details */}
        {tab === "details" && (
          <div className="flex flex-col gap-4">
            <div className="lh-card p-4">
              <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
                Unity Catalog metadata
              </h2>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {[
                  ["Full name", fullName],
                  ["Table type", t?.table_type ?? "—"],
                  ["Data source format", t?.data_source_format ?? "—"],
                  ["Storage location", t?.storage_location ?? "—"],
                  ["Table ID", t?.table_id ?? "—"],
                  ["Owner", t?.owner ?? "—"],
                  ["Created", formatDateTime(t?.created_at)],
                  ["Updated", formatDateTime(t?.updated_at)],
                ].map(([label, value]) => (
                  <div key={label as string} className="min-w-0">
                    <dt style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</dt>
                    <dd className="mono truncate" style={{ fontSize: 12 }} title={String(value)}>
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="lh-card p-4">
              <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
                Delta table detail
              </h2>
              {detail.loading && <Skeleton style={{ height: 120 }} />}
              {detail.error && <ErrorBanner message={detail.error} onRetry={detail.reload} />}
              {detail.data && detail.data.rows.length > 0 && (
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Format", detailRecord.format],
                    ["Number of files", detailRecord.numFiles],
                    ["Size on disk", typeof detailRecord.sizeInBytes === "number" ? formatBytes(detailRecord.sizeInBytes) : detailRecord.sizeInBytes],
                    ["Partition columns", Array.isArray(detailRecord.partitionColumns) && detailRecord.partitionColumns.length ? (detailRecord.partitionColumns as string[]).join(", ") : "none"],
                    ["Created at", formatDateTime(detailRecord.createdAt as string)],
                    ["Last modified", formatDateTime(detailRecord.lastModified as string)],
                    ["Min reader version", detailRecord.minReaderVersion],
                    ["Min writer version", detailRecord.minWriterVersion],
                    ["Location", detailRecord.location],
                  ].map(([label, value]) => (
                    <div key={label as string} className="min-w-0">
                      <dt style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label as string}</dt>
                      <dd className="mono truncate" style={{ fontSize: 12 }} title={formatCell(value)}>
                        {formatCell(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- History */}
        {tab === "history" && (
          <div className="lh-card overflow-hidden">
            {history.loading && <div className="p-3"><Skeleton style={{ height: 220 }} /></div>}
            {history.error && <div className="p-3"><ErrorBanner message={history.error} onRetry={history.reload} /></div>}
            {history.data && (
              <>
                <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-secondary)" }}>
                  Delta transaction log — every version is a point you can time travel to with{" "}
                  <span className="mono">VERSION AS OF</span>.
                </div>
                <HistoryTable result={history.data} fullName={fullName} />
              </>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- Lineage */}
        {tab === "lineage" && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-[4px] p-3"
              style={{ background: "var(--bg-info)", border: "1px solid var(--border)", fontSize: 12 }}
            >
              Unity Catalog OSS does not record lineage. This graph is derived from the SQL this workspace has
              executed — statements that read one table and write another.
            </div>
            {lineage.loading && <Skeleton style={{ height: 160 }} />}
            {lineage.data && !lineage.data.has_lineage && (
              <EmptyState
                title="No lineage recorded yet"
                description="Run an INSERT, MERGE or CREATE TABLE AS SELECT that touches this table and the relationship shows up here."
              />
            )}
            {lineage.data?.has_lineage && (
              <div className="grid gap-4 lg:grid-cols-2">
                <LineageList title="Upstream" subtitle="Tables that feed this one" edges={lineage.data.upstream} side="source" />
                <LineageList title="Downstream" subtitle="Tables built from this one" edges={lineage.data.downstream} side="target" />
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------- Insights */}
        {tab === "insights" && (
          <div className="lh-card overflow-hidden">
            {profile.loading && <div className="p-3"><Skeleton style={{ height: 220 }} /></div>}
            {profile.error && <div className="p-3"><ErrorBanner message={profile.error} onRetry={profile.reload} /></div>}
            {profile.data && (
              <>
                <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-secondary)" }}>
                  Profiled {formatNumber(profile.data.row_count)} rows with a single aggregate scan.
                </div>
                <DataTable
                  dense
                  rows={profile.data.columns}
                  keyOf={(row) => row.name}
                  emptyMessage="No columns to profile."
                  columns={[
                    { key: "name", header: "Column", render: (row) => <span className="mono font-medium">{row.name}</span> },
                    { key: "type", header: "Type", width: 130, render: (row) => <span className="mono" style={{ color: "var(--link)" }}>{row.type}</span> },
                    {
                      key: "nulls",
                      header: "Nulls",
                      align: "right",
                      width: 130,
                      render: (row) => (
                        <span>
                          {formatNumber(row.null_count)}
                          <span style={{ color: "var(--text-secondary)" }}> ({row.null_pct}%)</span>
                        </span>
                      ),
                    },
                    { key: "distinct", header: "Distinct", align: "right", width: 100, render: (row) => formatNumber(row.distinct) },
                    { key: "min", header: "Min", align: "right", width: 110, render: (row) => (row.min === null || row.min === undefined ? "—" : formatNumber(row.min, 2)) },
                    { key: "max", header: "Max", align: "right", width: 110, render: (row) => (row.max === null || row.max === undefined ? "—" : formatNumber(row.max, 2)) },
                    { key: "avg", header: "Mean", align: "right", width: 110, render: (row) => (row.avg === null || row.avg === undefined ? "—" : formatNumber(row.avg, 2)) },
                  ]}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTable({ result, fullName }: { result: QueryResult; fullName: string }) {
  const router = useRouter();
  const index = (name: string) => result.columns.findIndex((c) => c.name === name);
  const iVersion = index("version");
  const iTimestamp = index("timestamp");
  const iOperation = index("operation");
  const iMetrics = index("operationMetrics");
  const iEngine = index("engineInfo");

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--table-header-bg)" }}>
            {["Version", "Timestamp", "Operation", "Metrics", "Engine", ""].map((header) => (
              <th
                key={header}
                className="px-3 py-2 text-left font-medium"
                style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => {
            const version = iVersion >= 0 ? row[iVersion] : null;
            const metrics = iMetrics >= 0 ? (row[iMetrics] as Record<string, string> | null) : null;
            return (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="mono px-3 py-2 font-medium">{formatCell(version)}</td>
                <td className="px-3 py-2" style={{ whiteSpace: "nowrap" }}>
                  {formatDateTime(row[iTimestamp] as string)}
                  <span style={{ color: "var(--text-secondary)" }}> · {formatRelative(row[iTimestamp] as string)}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone="info">{formatCell(iOperation >= 0 ? row[iOperation] : "—")}</Badge>
                </td>
                <td className="mono px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                  {metrics
                    ? Object.entries(metrics)
                        .slice(0, 4)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("  ")
                    : "—"}
                </td>
                <td className="px-3 py-2" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {formatCell(iEngine >= 0 ? row[iEngine] : "—")}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    onClick={() =>
                      router.push(
                        `/sql-editor?sql=${encodeURIComponent(`SELECT * FROM ${fullName} VERSION AS OF ${version} LIMIT 100`)}`,
                      )
                    }
                  >
                    Time travel
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LineageList({
  title,
  subtitle,
  edges,
  side,
}: {
  title: string;
  subtitle: string;
  edges: { source: string; target: string; count: number; last_seen: string }[];
  side: "source" | "target";
}) {
  return (
    <div className="lh-card">
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="font-semibold" style={{ fontSize: 13 }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{subtitle}</div>
      </div>
      {edges.length === 0 && (
        <div className="px-3 py-6 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          None recorded.
        </div>
      )}
      {edges.map((edge, i) => {
        const other = side === "source" ? edge.source : edge.target;
        const parts = other.split(".");
        const href =
          parts.length === 3
            ? `/catalog/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`
            : null;
        return (
          <div key={`${other}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <ArrowRight size={13} style={{ color: "var(--action-icon-default)", transform: side === "source" ? "rotate(180deg)" : undefined }} />
              {href ? (
                <Link href={href} className="mono truncate" style={{ fontSize: 12 }}>
                  {other}
                </Link>
              ) : (
                <span className="mono truncate" style={{ fontSize: 12 }}>
                  {other}
                </span>
              )}
            </span>
            <span className="shrink-0" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {edge.count}× · {formatRelative(edge.last_seen)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
