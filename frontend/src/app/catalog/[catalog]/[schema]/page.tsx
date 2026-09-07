"use client";

import { FileCode2, FolderOpen, Plus, Table2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, DataTable, EmptyState, ErrorBanner, Field, Input, Modal, SearchInput, Skeleton, Tabs, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function SchemaPage() {
  const params = useParams<{ catalog: string; schema: string }>();
  const catalog = decodeURIComponent(params.catalog);
  const schema = decodeURIComponent(params.schema);
  const router = useRouter();
  const toast = useToast();

  const objects = useAsync(() => api.catalog.objects(catalog, schema), [catalog, schema]);
  const [tab, setTab] = useState("tables");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [ddl, setDdl] = useState("");
  const [busy, setBusy] = useState(false);

  const data = objects.data;
  const match = (name: string) => name.toLowerCase().includes(search.toLowerCase());

  const openCreate = () => {
    setDdl(
      `CREATE TABLE ${catalog}.${schema}.new_table (\n  id INT,\n  name STRING,\n  created_at TIMESTAMP\n)\nUSING DELTA\nLOCATION 'file:///data/warehouse/${schema}/new_table'`,
    );
    setCreating(true);
  };

  const runCreate = async () => {
    setBusy(true);
    try {
      const result = await api.sql.execute({ sql: ddl, source: "catalog" });
      // DDL runs through the async path; poll until it settles.
      let status = result;
      for (let i = 0; i < 120 && status.status === "RUNNING"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        status = await api.sql.status(result.id);
      }
      if (status.status === "FAILED") throw new Error(status.error ?? "Statement failed");
      toast("Table created", "success");
      setCreating(false);
      objects.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create table", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={schema}
        breadcrumbs={[
          { label: "Catalog", href: "/catalog" },
          { label: catalog, href: `/catalog/${encodeURIComponent(catalog)}` },
          { label: schema },
        ]}
        description={`${catalog}.${schema}`}
        actions={
          <>
            <Button
              onClick={() =>
                router.push(`/sql-editor?sql=${encodeURIComponent(`SHOW TABLES IN ${catalog}.${schema}`)}`)
              }
            >
              Open in SQL editor
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>
              Create table
            </Button>
          </>
        }
      />

      <div className="px-6">
        <Tabs
          active={tab}
          onChange={setTab}
          className="mb-3"
          tabs={[
            { id: "tables", label: "Tables", count: data?.tables.length },
            { id: "volumes", label: "Volumes", count: data?.volumes.length },
            { id: "functions", label: "Functions", count: data?.functions.length },
          ]}
        />

        <SearchInput value={search} onChange={setSearch} placeholder={`Filter ${tab}`} className="mb-3 max-w-xs" />

        {objects.loading && <Skeleton style={{ height: 200 }} />}
        {objects.error && <ErrorBanner message={objects.error} onRetry={objects.reload} />}

        {data && tab === "tables" && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={data.tables.filter((t) => match(t.name))}
              keyOf={(row) => row.name}
              emptyMessage="No tables in this schema."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <Link
                      href={`/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(schema)}/${encodeURIComponent(row.name)}`}
                      className="inline-flex items-center gap-2 font-medium"
                    >
                      <Table2 size={14} style={{ color: "var(--action-icon-default)" }} />
                      {row.name}
                    </Link>
                  ),
                },
                { key: "type", header: "Type", width: 110, render: (row) => <Badge>{row.table_type ?? "TABLE"}</Badge> },
                { key: "format", header: "Format", width: 100, render: (row) => <Badge tone="info">{row.data_source_format ?? "—"}</Badge> },
                {
                  key: "location",
                  header: "Location",
                  render: (row) => (
                    <span className="mono block truncate" style={{ fontSize: 12, color: "var(--text-secondary)", maxWidth: 300 }} title={row.storage_location}>
                      {row.storage_location ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "comment",
                  header: "Comment",
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.comment || "—"}</span>,
                },
                {
                  key: "created",
                  header: "Created",
                  width: 180,
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.created_at)}</span>,
                },
              ]}
            />
          </div>
        )}

        {data && tab === "volumes" && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={data.volumes.filter((v) => match(v.name))}
              keyOf={(row) => row.full_name}
              emptyMessage="No volumes in this schema."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <FolderOpen size={14} style={{ color: "var(--action-icon-default)" }} />
                      {row.name}
                    </span>
                  ),
                },
                { key: "type", header: "Type", width: 120, render: (row) => <Badge>{row.volume_type ?? "—"}</Badge> },
                {
                  key: "location",
                  header: "Storage location",
                  render: (row) => (
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {row.storage_location ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "created",
                  header: "Created",
                  width: 180,
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatDateTime(row.created_at)}</span>,
                },
              ]}
            />
          </div>
        )}

        {data && tab === "functions" && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={data.functions.filter((f) => match(f.name))}
              keyOf={(row) => row.name}
              emptyMessage="No functions in this schema."
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (row) => (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <FileCode2 size={14} style={{ color: "var(--action-icon-default)" }} />
                      {row.name}
                    </span>
                  ),
                },
                {
                  key: "params",
                  header: "Parameters",
                  render: (row) => (
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      ({(row.input_params?.parameters ?? []).map((p) => `${p.name} ${p.type_text ?? ""}`.trim()).join(", ")})
                    </span>
                  ),
                },
                { key: "returns", header: "Returns", width: 140, render: (row) => <Badge tone="info">{row.data_type ?? "—"}</Badge> },
                {
                  key: "comment",
                  header: "Comment",
                  render: (row) => <span style={{ color: "var(--text-secondary)" }}>{row.comment || "—"}</span>,
                },
              ]}
            />
          </div>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create table"
        width={680}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={runCreate} loading={busy}>
              Run statement
            </Button>
          </>
        }
      >
        <Field
          label="CREATE TABLE statement"
          hint="Runs against Spark Connect. Managed Delta tables in this stack live under file:///data/warehouse — the path is mounted into the Spark containers."
        >
          <Textarea value={ddl} onChange={(e) => setDdl(e.target.value)} rows={9} className="mono" />
        </Field>
      </Modal>
    </div>
  );
}
