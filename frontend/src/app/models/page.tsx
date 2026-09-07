"use client";

import { Boxes } from "lucide-react";
import React from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { DataTable, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";

/** Registered models live in Unity Catalog under catalog.schema, so this page
 *  walks every schema and collects what the models API returns. */
export default function ModelsPage() {
  const models = useAsync(async () => {
    const catalogs = await api.catalog.catalogs();
    const found: { name: string; catalog: string; schema: string }[] = [];
    for (const catalog of catalogs) {
      const schemas = await api.catalog.schemas(catalog.name);
      for (const schema of schemas) {
        const objects = await api.catalog.objects(catalog.name, schema.name);
        for (const model of objects.models as { name?: string }[]) {
          found.push({ name: model.name ?? "unnamed", catalog: catalog.name, schema: schema.name });
        }
      }
    }
    return found;
  }, []);

  return (
    <div className="pb-10">
      <PageHeader title="Models" description="Models registered in Unity Catalog" />

      <div className="px-6">
        {models.loading && <Skeleton style={{ height: 160 }} />}
        {models.error && <ErrorBanner message={models.error} onRetry={models.reload} />}

        {models.data && models.data.length === 0 && (
          <EmptyState
            icon={<Boxes size={28} />}
            title="No registered models"
            description="Unity Catalog exposes a model registry, but nothing has been registered in this workspace yet. Register a model from MLflow to see it here."
          />
        )}

        {models.data && models.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={models.data}
              keyOf={(row, i) => `${row.catalog}.${row.schema}.${row.name}-${i}`}
              columns={[
                { key: "name", header: "Model", render: (row) => <span className="font-medium">{row.name}</span> },
                { key: "catalog", header: "Catalog", width: 160, render: (row) => row.catalog },
                { key: "schema", header: "Schema", width: 160, render: (row) => row.schema },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
