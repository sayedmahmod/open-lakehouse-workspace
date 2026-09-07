"use client";

import { Import, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, ErrorBanner, Field, Input, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

/** Ingestion recipes that work against this stack, rendered as runnable SQL. */
function recipe(kind: string, target: string, source: string): string {
  switch (kind) {
    case "csv":
      return `CREATE TABLE ${target}\nUSING DELTA\nLOCATION 'file:///data/warehouse/${target.split(".").slice(-2).join("/")}'\nAS SELECT * FROM read_files(\n  '${source}',\n  format => 'csv',\n  header => true,\n  inferSchema => true\n)`;
    case "json":
      return `CREATE TABLE ${target}\nUSING DELTA\nLOCATION 'file:///data/warehouse/${target.split(".").slice(-2).join("/")}'\nAS SELECT * FROM read_files('${source}', format => 'json')`;
    case "parquet":
      return `CREATE TABLE ${target}\nUSING DELTA\nLOCATION 'file:///data/warehouse/${target.split(".").slice(-2).join("/")}'\nAS SELECT * FROM parquet.\`${source}\``;
    case "ctas":
    default:
      return `CREATE TABLE ${target}\nUSING DELTA\nLOCATION 'file:///data/warehouse/${target.split(".").slice(-2).join("/")}'\nAS SELECT *\nFROM ${source}`;
  }
}

export default function IngestionPage() {
  const kafka = useAsync(() => api.streaming.status(), []);
  const config = useAsync(() => api.config(), []);
  const router = useRouter();
  const toast = useToast();

  const [kind, setKind] = useState("csv");
  const [target, setTarget] = useState("unity.bronze.new_table");
  const [source, setSource] = useState("file:///data/landing/orders.csv");

  const sql = recipe(kind, target, source);

  return (
    <div className="pb-10">
      <PageHeader
        title="Data Ingestion"
        description="Load files into Delta tables, and check the streaming source behind this stack"
      />

      <div className="px-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lh-card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold" style={{ fontSize: 14 }}>
              <Upload size={15} style={{ color: "var(--action-icon-default)" }} />
              Build an ingestion statement
            </h2>
            <div className="flex flex-col gap-3">
              <Field label="Source format">
                <Select
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "csv", label: "CSV file" },
                    { value: "json", label: "JSON file" },
                    { value: "parquet", label: "Parquet file" },
                    { value: "ctas", label: "Another table (CTAS)" },
                  ]}
                />
              </Field>
              <Field
                label="Source path"
                hint="Paths are resolved inside the Spark containers. The repo's ./data directory is mounted at /data."
              >
                <Input value={source} onChange={(e) => setSource(e.target.value)} className="mono" />
              </Field>
              <Field label="Target table" hint="catalog.schema.table">
                <Input value={target} onChange={(e) => setTarget(e.target.value)} className="mono" />
              </Field>
              <Field label="Generated statement">
                <Textarea value={sql} readOnly rows={9} className="mono" />
              </Field>
              <div>
                <Button
                  variant="primary"
                  icon={<Import size={14} />}
                  onClick={() => router.push(`/sql-editor?sql=${encodeURIComponent(sql)}`)}
                >
                  Open in SQL editor
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="lh-card p-4">
              <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
                Streaming source
              </h2>
              {kafka.loading && <Skeleton style={{ height: 60 }} />}
              {kafka.data && (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div style={{ fontSize: 13 }}>Apache Kafka</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {kafka.data.bootstrap}
                    </div>
                  </div>
                  <Badge tone={kafka.data.reachable ? "success" : "danger"}>
                    {kafka.data.reachable ? "Reachable" : "Unreachable"}
                  </Badge>
                </div>
              )}
              <p className="mt-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Structured Streaming jobs run through Spark Connect. Write the readStream/writeStream in a notebook cell
                and drive it from a scheduled job.
              </p>
            </div>

            <div className="lh-card p-4">
              <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
                Storage
              </h2>
              {config.data && (
                <dl className="grid gap-y-2">
                  {[
                    ["Object store", config.data.s3_endpoint],
                    ["Warehouse root", config.data.warehouse_root],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</dt>
                      <dd className="mono truncate" style={{ fontSize: 12 }}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Unity Catalog tables in this stack are created under <span className="mono">file:///data/warehouse</span>,
                a host directory mounted into every Spark container.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
