"use client";

import { Check, Monitor, Moon, Plus, Search, Settings, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { Button, Dropdown, IconButton } from "../ui";
import { SearchDialog } from "./SearchDialog";
import { useTheme } from "./ThemeProvider";

/** Objects the "+ New" menu can create. */
const NEW_ITEMS: { label: string; href: string }[] = [
  { label: "Notebook", href: "/notebooks?new=1" },
  { label: "Query", href: "/sql-editor" },
  { label: "Dashboard", href: "/dashboards?new=1" },
  { label: "Alert", href: "/alerts?new=1" },
  { label: "Job", href: "/jobs?new=1" },
];

export function TopBar() {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Cmd/Ctrl-K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className="flex h-12 shrink-0 items-center gap-3 px-3"
        style={{ background: "var(--bg-primary)", borderBottom: "1px solid var(--border)" }}
      >
        <Dropdown
          align="left"
          trigger={
            <Button size="sm" variant="primary" icon={<Plus size={14} />}>
              New
            </Button>
          }
          items={NEW_ITEMS.map((item) => ({ label: item.label, onClick: () => router.push(item.href) }))}
        />

        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-8 max-w-2xl flex-1 items-center gap-2 rounded-[4px] px-2.5 text-left transition-colors"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: 13,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--action-default-border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <Search size={14} />
          <span className="flex-1">Search data, notebooks, queries, jobs…</span>
          <kbd
            className="rounded px-1.5 py-0.5"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", fontSize: 11 }}
          >
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <Dropdown
            trigger={
              <IconButton title="Appearance">
                {theme === "dark" ? <Moon size={15} /> : theme === "light" ? <Sun size={15} /> : <Monitor size={15} />}
              </IconButton>
            }
            items={[
              { label: "Prefer light", icon: theme === "light" ? <Check size={13} /> : <Sun size={13} />, onClick: () => setTheme("light") },
              { label: "Prefer dark", icon: theme === "dark" ? <Check size={13} /> : <Moon size={13} />, onClick: () => setTheme("dark") },
              { label: "Use system settings", icon: theme === "system" ? <Check size={13} /> : <Monitor size={13} />, onClick: () => setTheme("system") },
            ]}
          />
          <IconButton title="Settings" onClick={() => router.push("/settings")}>
            <Settings size={15} />
          </IconButton>
          <div
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full font-semibold"
            style={{ background: "var(--tag-charcoal)", color: "#fff", fontSize: 11 }}
            title="Local workspace — no authentication configured"
          >
            OL
          </div>
        </div>
      </header>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
