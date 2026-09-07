"use client";

import {
  BellRing,
  Database,
  LayoutDashboard,
  NotebookText,
  Table2,
  Terminal,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import React from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatNumber, formatRelative } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

function StatCard({ label, value, href, icon }: { label: string; value: React.ReactNode; href: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="lh-card flex items-center gap-3 p-3 transition-colors"
      style={{ textDecoration: "none" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--action-default-border-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px]"
        style={{ background: "var(--bg-secondary)", color: "var(--action-icon-default)" }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold" style={{ fontSize: 20, lineHeight: "26px", color: "var(--text-primary)" }}>
          {value}
        </span>
        <span className="block truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {label}
        </span>
      </span>
    </Link>
  );
}

export default function HomePage() {
  const summary = useAsync(() => api.workspace.summary(), []);
  const health = useAsync(() => api.compute.health(), []);
  const recents = useAsync(() => api.workspace.recents(8), []);

  const s = summary.data;

  return (
    <div className="pb-10">
      <PageHeader
        title="open-lakehouse"
        description="Unity Catalog · Apache Spark 4.1 · Delta Lake — running locally on Docker"
      />

      <div className="px-6">
        {/* Service health, the first thing worth knowing on a local stack. */}
        <section className="mb-6">
          <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
            Stack status
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {health.loading &&
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} style={{ height: 58 }} />)}
            {health.data?.services.map((service) => (
              <div key={service.name} className="lh-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" style={{ fontSize: 13 }}>
                    {service.name}
                  </span>
                  <Badge tone={service.healthy ? "success" : "danger"}>{service.healthy ? "Healthy" : "Down"}</Badge>
                </div>
                <div className="mono mt-1 truncate" style={{ fontSize: 11, color: "var(--text-secondary)" }} title={service.endpoint}>
                  {service.detail ?? service.endpoint}
                </div>
              </div>
            ))}
            {health.error && (
              <div className="lh-card p-3" style={{ gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, color: "var(--text-danger)" }}>
                  Workspace API unreachable — {health.error}
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
            Workspace
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {summary.loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} style={{ height: 62 }} />)}
            {s && (
              <>
                <StatCard label="Tables" value={formatNumber(s.catalog.tables)} href="/catalog" icon={<Table2 size={17} />} />
                <StatCard label="Schemas" value={formatNumber(s.catalog.schemas)} href="/catalog" icon={<Database size={17} />} />
                <StatCard label="Notebooks" value={formatNumber(s.notebooks)} href="/notebooks" icon={<NotebookText size={17} />} />
                <StatCard label="Saved queries" value={formatNumber(s.queries)} href="/queries" icon={<Terminal size={17} />} />
                <StatCard label="Dashboards" value={formatNumber(s.dashboards)} href="/dashboards" icon={<LayoutDashboard size={17} />} />
                <StatCard label="Jobs" value={formatNumber(s.jobs)} href="/jobs" icon={<Workflow size={17} />} />
              </>
            )}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
              Recents
            </h2>
            <div className="lh-card">
              {recents.loading && <div className="p-3"><Skeleton style={{ height: 80 }} /></div>}
              {recents.data && recents.data.length === 0 && (
                <EmptyState title="Nothing opened yet" description="Notebooks, queries and dashboards you open show up here." />
              )}
              {recents.data?.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  style={{ borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text-primary)" }}
                >
                  <span className="truncate" style={{ fontSize: 13 }}>
                    {item.name}
                  </span>
                  <span className="shrink-0" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {formatRelative(item.visited_at)}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-semibold" style={{ fontSize: 14 }}>
              Get started
            </h2>
            <div className="lh-card divide-y" style={{ borderColor: "var(--border)" }}>
              {[
                { label: "Browse the catalog", description: "Explore schemas, tables, columns and Delta history", href: "/catalog", icon: <Database size={16} /> },
                { label: "Open the SQL editor", description: "Run Spark SQL with catalog-aware autocomplete", href: "/sql-editor", icon: <Terminal size={16} /> },
                { label: "Build a dashboard", description: "Chart the results of saved SQL datasets", href: "/dashboards", icon: <LayoutDashboard size={16} /> },
                { label: "Schedule a job", description: "Chain SQL and notebook tasks into a DAG", href: "/jobs", icon: <Workflow size={16} /> },
                { label: "Create an alert", description: "Watch a query result against a threshold", href: "/alerts", icon: <BellRing size={16} /> },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5"
                  style={{ textDecoration: "none", color: "var(--text-primary)" }}
                >
                  <span style={{ color: "var(--action-icon-default)" }}>{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block font-medium" style={{ fontSize: 13 }}>
                      {item.label}
                    </span>
                    <span className="block truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {item.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
