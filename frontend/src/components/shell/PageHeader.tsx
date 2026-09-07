"use client";

import Link from "next/link";
import React from "react";

/** Standard page chrome: breadcrumb, title, description and page actions. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-6 pb-4 pt-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1" style={{ fontSize: 12 }}>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && <span style={{ color: "var(--text-secondary)" }}>/</span>}
              {crumb.href ? (
                <Link href={crumb.href} style={{ color: "var(--link)" }}>
                  {crumb.label}
                </Link>
              ) : (
                <span style={{ color: "var(--text-secondary)" }}>{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-semibold" style={{ fontSize: 20, lineHeight: "28px" }}>
            {icon}
            <span className="truncate">{title}</span>
          </h1>
          {description && (
            <p className="mt-0.5" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
