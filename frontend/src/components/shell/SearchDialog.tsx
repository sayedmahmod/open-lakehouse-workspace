"use client";

import {
  BellRing,
  Database,
  FileCode2,
  LayoutDashboard,
  NotebookText,
  Search,
  Table2,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";
import { Spinner } from "../ui";

const ICONS: Record<string, React.ReactNode> = {
  table: <Table2 size={15} />,
  catalog: <Database size={15} />,
  schema: <Database size={15} />,
  notebook: <NotebookText size={15} />,
  query: <FileCode2 size={15} />,
  dashboard: <LayoutDashboard size={15} />,
  job: <Workflow size={15} />,
  alert: <BellRing size={15} />,
};

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTerm("");
      setResults([]);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Debounced search so each keystroke does not hit Unity Catalog.
  useEffect(() => {
    if (!open) return;
    const query = term.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        setResults(await api.workspace.search(query));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [term, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(results.length - 1, c + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      }
      if (e.key === "Enter" && results[cursor]) {
        onClose();
        router.push(results[cursor].href);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, cursor, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-2xl overflow-hidden rounded-[8px]"
        style={{ background: "var(--bg-primary)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center gap-2 px-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <Search size={16} style={{ color: "var(--text-secondary)" }} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setCursor(0);
            }}
            placeholder="Search tables, notebooks, queries, dashboards, jobs and alerts"
            className="h-12 flex-1 bg-transparent outline-none"
            style={{ fontSize: 14, color: "var(--text-primary)" }}
          />
          {loading && <Spinner size={14} />}
        </div>

        <div className="max-h-96 overflow-y-auto py-1">
          {!term.trim() && (
            <div className="px-4 py-8 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Start typing to search the workspace and Unity Catalog.
            </div>
          )}
          {term.trim() && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              No matches for “{term}”.
            </div>
          )}
          {results.map((result, i) => (
            <button
              key={`${result.kind}-${result.id}-${i}`}
              onClick={() => {
                onClose();
                router.push(result.href);
              }}
              onMouseEnter={() => setCursor(i)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left"
              style={{ background: i === cursor ? "var(--table-row-hover)" : "transparent" }}
            >
              <span style={{ color: "var(--action-icon-default)" }}>{ICONS[result.kind] ?? <Search size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                  {result.name}
                </span>
                <span className="block truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {result.subtitle}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
