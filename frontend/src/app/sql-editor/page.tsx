"use client";

import {
  ChevronDown,
  ChevronRight,
  Database,
  Play,
  RefreshCw,
  Save,
  Square,
  Table2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiEditButton } from "@/components/ai";
import { ResultGrid } from "@/components/sql/ResultGrid";
import { SqlEditor, useCompletionData } from "@/components/sql/SqlEditor";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  SearchInput,
  Spinner,
  useResizable,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { QueryResult } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

const DEFAULT_SQL = "SHOW CATALOGS";

function SqlEditorInner() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const completion = useCompletionData();

  const [sqlText, setSqlText] = useState(DEFAULT_SQL);
  const [selection, setSelection] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [selRect, setSelRect] = useState<{ top: number; left: number } | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { size: sidebarWidth, handle: sidebarHandle } = useResizable(260, 180, 460, "x");
  const { size: editorHeight, handle: editorHandle } = useResizable(280, 120, 700, "y");

  // Seed the editor from ?sql= or ?query= (a saved query id).
  useEffect(() => {
    const seed = searchParams.get("sql");
    const queryId = searchParams.get("query");
    if (queryId) {
      api.sql
        .getSaved(queryId)
        .then((saved) => {
          setSqlText(saved.sql);
          setSavedId(saved.id);
          setSavedName(saved.name);
          api.workspace
            .trackRecent({ kind: "query", object_id: saved.id, name: saved.name, href: `/sql-editor?query=${saved.id}` })
            .catch(() => {});
        })
        .catch(() => toast("Could not load that saved query", "danger"));
    } else if (seed) {
      setSqlText(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const next = await api.sql.status(id);
        setResult(next);
        if (next.status === "RUNNING") {
          pollRef.current = setTimeout(tick, 400);
        } else {
          setRunning(false);
        }
      } catch (err) {
        setRunning(false);
        toast(err instanceof Error ? err.message : "Lost track of the query", "danger");
      }
    };
    pollRef.current = setTimeout(tick, 300);
  }, [toast]);

  const run = useCallback(async () => {
    if (!sqlText.trim() || running) return;
    stopPolling();
    setRunning(true);
    setResult(null);
    try {
      const started = await api.sql.execute({ sql: sqlText, source: "editor", source_id: savedId ?? undefined });
      setResult(started);
      if (started.status === "RUNNING") poll(started.id);
      else setRunning(false);
    } catch (err) {
      setRunning(false);
      toast(err instanceof Error ? err.message : "Could not start the query", "danger");
    }
  }, [sqlText, running, savedId, poll, toast]);

  const cancel = async () => {
    if (!result) return;
    try {
      await api.sql.cancel(result.id);
      toast("Cancellation requested", "info");
    } catch {
      toast("Could not cancel the query", "danger");
    }
  };

  const save = async () => {
    try {
      if (savedId) {
        await api.sql.updateSaved(savedId, { sql: sqlText });
        toast(`Saved “${savedName}”`, "success");
      } else {
        const created = await api.sql.createSaved({ name: saveName.trim() || "Untitled query", sql: sqlText });
        setSavedId(created.id);
        setSavedName(created.name);
        toast(`Saved “${created.name}”`, "success");
      }
      setSaveOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <SchemaBrowser width={sidebarWidth} onInsert={(text) => setSqlText((prev) => `${prev}${prev.endsWith(" ") || prev === "" ? "" : " "}${text}`)} />
      {sidebarHandle}

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Button
            variant="primary"
            icon={<Play size={13} />}
            onClick={run}
            disabled={running || !sqlText.trim()}
          >
            Run
          </Button>
          {running && (
            <Button icon={<Square size={13} />} onClick={cancel}>
              Cancel
            </Button>
          )}
          <Button
            icon={<Save size={13} />}
            onClick={() => {
              if (savedId) save();
              else {
                setSaveName("");
                setSaveOpen(true);
              }
            }}
          >
            {savedId ? "Save" : "Save as…"}
          </Button>
          {savedName && <Badge tone="info">{savedName}</Badge>}

          <span className="ml-auto flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {running && (
              <>
                <Spinner size={13} /> Running…
              </>
            )}
            {!running && result?.status === "FINISHED" && (
              <>Completed in {formatDuration(result.duration_ms)}</>
            )}
            <kbd
              className="rounded px-1.5 py-0.5"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", fontSize: 11 }}
            >
              ⌘↵
            </kbd>
          </span>
        </div>

        <div style={{ height: editorHeight }} className="relative min-h-0 shrink-0 overflow-hidden">
          <AiEditButton
            value={sqlText}
            language="sql"
            selection={selection}
            selectionRect={selRect}
            onApply={setSqlText}
            surface="sql-editor"
            context={{ tables: completion.tables }}
            floating
          />
          <SqlEditor
            value={sqlText}
            onChange={setSqlText}
            onRun={run}
            onSelectionChange={(s) => {
              setSelection({ from: s.from, to: s.to });
              setSelRect(s.rect);
            }}
            completion={completion}
            height="100%"
            placeholder="SELECT * FROM unity.default.my_table LIMIT 100"
          />
        </div>

        {editorHandle}

        <div className="min-h-0 flex-1 overflow-hidden">
          {!result && !running && (
            <div className="flex h-full items-center justify-center px-6 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Write a statement and press Run (⌘↵) to execute it against Spark Connect.
            </div>
          )}
          {running && !result?.columns?.length && (
            <div className="flex h-full flex-col items-center justify-center gap-2" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              <Spinner size={20} />
              Executing on the Spark cluster…
            </div>
          )}
          {result && result.status !== "RUNNING" && <ResultGrid result={result} />}
        </div>
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save query"
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Query name" required>
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Daily order volume" autoFocus />
        </Field>
      </Modal>
    </div>
  );
}

/** Catalog tree beside the editor — click a table to insert its full name. */
function SchemaBrowser({ width, onInsert }: { width: number; onInsert: (text: string) => void }) {
  const tree = useAsync(() => api.catalog.tree(), []);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");

  const toggleSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`;
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    if (!tables[key]) {
      try {
        const objects = await api.catalog.objects(catalog, schema);
        setTables((prev) => ({ ...prev, [key]: objects.tables.map((t) => t.name) }));
      } catch {
        setTables((prev) => ({ ...prev, [key]: [] }));
      }
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return tree.data ?? [];
    const needle = search.toLowerCase();
    return (tree.data ?? [])
      .map((cat) => ({ ...cat, schemas: cat.schemas.filter((s) => s.toLowerCase().includes(needle) || cat.name.toLowerCase().includes(needle)) }))
      .filter((cat) => cat.schemas.length > 0 || cat.name.toLowerCase().includes(needle));
  }, [tree.data, search]);

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden"
      style={{ width, background: "var(--bg-secondary)", borderRight: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 px-2 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="font-semibold" style={{ fontSize: 12 }}>
          Catalog
        </span>
        <IconButton title="Refresh" className="ml-auto" onClick={tree.reload}>
          <RefreshCw size={13} />
        </IconButton>
      </div>
      <div className="px-2 py-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {tree.loading && <div className="px-3 py-2"><Spinner size={14} /></div>}
        {tree.error && (
          <div className="px-3 py-2" style={{ fontSize: 12, color: "var(--text-danger)" }}>
            {tree.error}
          </div>
        )}
        {filtered.map((cat) => (
          <div key={cat.name}>
            <div className="flex items-center gap-1.5 px-2 py-1" style={{ fontSize: 12, fontWeight: 600 }}>
              <Database size={13} style={{ color: "var(--action-icon-default)" }} />
              {cat.name}
            </div>
            {cat.schemas.map((schema) => {
              const key = `${cat.name}.${schema}`;
              const open = expanded[key];
              return (
                <div key={key}>
                  <button
                    onClick={() => toggleSchema(cat.name, schema)}
                    className="flex w-full items-center gap-1 px-2 py-1 pl-4 text-left"
                    style={{ fontSize: 12, color: "var(--text-primary)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--table-row-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="truncate">{schema}</span>
                  </button>
                  {open &&
                    (tables[key] ?? []).map((table) => (
                      <button
                        key={table}
                        onClick={() => onInsert(`${cat.name}.${schema}.${table}`)}
                        title={`Insert ${cat.name}.${schema}.${table}`}
                        className="flex w-full items-center gap-1.5 px-2 py-1 pl-9 text-left"
                        style={{ fontSize: 12, color: "var(--text-secondary)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--table-row-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <Table2 size={12} />
                        <span className="truncate">{table}</span>
                      </button>
                    ))}
                  {open && tables[key]?.length === 0 && (
                    <div className="px-2 py-1 pl-9" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      No tables
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function SqlEditorPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <SqlEditorInner />
    </Suspense>
  );
}
