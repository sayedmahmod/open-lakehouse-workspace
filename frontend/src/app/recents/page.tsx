"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, DataTable, EmptyState, ErrorBanner, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

export default function RecentsPage() {
  const recents = useAsync(() => api.workspace.recents(50), []);
  const router = useRouter();

  return (
    <div className="pb-10">
      <PageHeader title="Recents" description="What you opened most recently" />

      <div className="px-6">
        {recents.loading && <Skeleton style={{ height: 180 }} />}
        {recents.error && <ErrorBanner message={recents.error} onRetry={recents.reload} />}

        {recents.data && recents.data.length === 0 && (
          <EmptyState icon={<Clock size={28} />} title="Nothing here yet" description="Tables, notebooks and dashboards you open are listed here." />
        )}

        {recents.data && recents.data.length > 0 && (
          <div className="lh-card overflow-hidden">
            <DataTable
              rows={recents.data}
              keyOf={(row) => row.id}
              onRowClick={(row) => router.push(row.href)}
              columns={[
                { key: "name", header: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
                { key: "kind", header: "Type", width: 130, render: (row) => <Badge>{row.kind}</Badge> },
                { key: "when", header: "Opened", width: 170, render: (row) => <span style={{ color: "var(--text-secondary)" }}>{formatRelative(row.visited_at)}</span> },
                { key: "at", header: "", width: 180, render: (row) => <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{formatDateTime(row.visited_at)}</span> },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
