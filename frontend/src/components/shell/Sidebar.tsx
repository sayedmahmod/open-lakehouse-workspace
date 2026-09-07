"use client";

import clsx from "clsx";
import * as Icons from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

import { NAV } from "./nav";

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name];
  return Cmp ? <Cmp size={size} /> : <Icons.Circle size={size} />;
}

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string, prefix?: boolean) =>
    prefix ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;

  return (
    <nav
      aria-label="Main"
      className="flex h-full flex-col"
      style={{
        width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        transition: "width 120ms ease",
      }}
    >
      {/* Brand */}
      <div
        className="flex h-12 shrink-0 items-center gap-2 px-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Link href="/" className="flex items-center gap-2 overflow-hidden" style={{ color: "var(--text-primary)" }}>
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] font-bold"
            style={{ background: "var(--brand)", color: "#fff", fontSize: 12 }}
            aria-hidden
          >
            ◆
          </span>
          {!collapsed && (
            <span className="truncate font-semibold" style={{ fontSize: 14 }}>
              open-lakehouse
            </span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {NAV.map((section, index) => (
          <div key={section.label ?? index} className="mb-1">
            {section.label && !collapsed && (
              <div
                className="px-3 pb-1 pt-3 font-semibold uppercase"
                style={{ fontSize: 11, letterSpacing: "0.04em", color: "var(--text-secondary)" }}
              >
                {section.label}
              </div>
            )}
            {section.label && collapsed && (
              <div className="mx-3 my-2" style={{ borderTop: "1px solid var(--border)" }} />
            )}
            {section.items.map((item) => {
              const active = isActive(item.href, item.prefix);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    "mx-2 flex items-center gap-2.5 rounded-[4px] px-2 py-1.5 transition-colors",
                    collapsed && "justify-center",
                  )}
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--link)" : "var(--text-primary)",
                    background: active ? "var(--action-default-bg-hover)" : "transparent",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = "var(--table-row-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="shrink-0" style={{ color: active ? "var(--link)" : "var(--action-icon-default)" }}>
                    <Icon name={item.icon} />
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shrink-0 p-2" style={{ borderTop: "1px solid var(--border)" }}>
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={clsx("flex w-full items-center gap-2.5 rounded-[4px] px-2 py-1.5", collapsed && "justify-center")}
          style={{ fontSize: 13, color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--table-row-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {collapsed ? <Icons.PanelLeftOpen size={16} /> : <Icons.PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
