"use client";

import { ChevronDown, ChevronUp, Play, PlaySquare, Plus, Save, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";

import { AiEditButton } from "@/components/ai";
import { PageHeader } from "@/components/shell/PageHeader";
import { ResultTable } from "@/components/charts/Chart";
import { SqlEditor, useCompletionData } from "@/components/sql/SqlEditor";
import { Badge, Button, ErrorBanner, IconButton, Input, Select, Skeleton, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDuration, formatNumber } from "@/lib/format";
import type { Notebook, NotebookCell, QueryResult } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const completion = useCompletionData();

  const notebook = useAsync(() => api.notebooks.get(id), [id]);
  const [draft, setDraft] = useState<Notebook | null>(null);
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [runningCell, setRunningCell] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selections, setSelections] = useState<Record<string, { from: number; to: number }>>({});
  const [selRects, setSelRects] = useState<Record<string, { top: number; left: number } | null>>({});

  useEffect(() => {
    if (notebook.data) {
      setDraft(structuredClone(notebook.data));
      api.workspace
        .trackRecent({ kind: "notebook", object_id: notebook.data.id, name: notebook.data.name, href: `/notebooks/${notebook.data.id}` })
        .catch(() => {});
    }
  }, [notebook.data]);

  const mutate = (fn: (draft: Notebook) => Notebook) => {
    setDraft((prev) => (prev ? fn(structuredClone(prev)) : prev));
    setDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.notebooks.update(id, { name: draft.name, cells: draft.cells });
      toast("Notebook saved", "success");
      setDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    } finally {
      setSaving(false);
    }
  };

  const runCell = async (cell: NotebookCell) => {
    setRunningCell(cell.id);
    try {
      const result = await api.notebooks.runCell(id, cell.id, { source: cell.source, language: cell.language });
      setResults((prev) => ({ ...prev, [cell.id]: result }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Cell failed", "danger");
    } finally {
      setRunningCell(null);
    }
  };

  const runAll = async () => {
    setRunningAll(true);
    try {
      const { results: all } = await api.notebooks.runAll(id);
      const next: Record<string, QueryResult> = {};
      all.forEach((r) => {
        next[r.cell_id] = r;
      });
      setResults(next);
      const failed = all.find((r) => r.status === "FAILED");
      toast(failed ? "A cell failed — the run stopped there" : "All cells ran", failed ? "danger" : "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Run failed", "danger");
    } finally {
      setRunningAll(false);
    }
  };

  const addCell = (index: number) => {
    mutate((d) => {
      const cells = [...d.cells];
      cells.splice(index + 1, 0, { id: crypto.randomUUID(), language: "sql", source: "" });
      return { ...d, cells };
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    mutate((d) => {
      const cells = [...d.cells];
      const target = index + direction;
      if (target < 0 || target >= cells.length) return d;
      [cells[index], cells[target]] = [cells[target], cells[index]];
      return { ...d, cells };
    });
  };

  return (
    <div className="pb-16">
      <PageHeader
        title={
          draft ? (
            <Input
              value={draft.name}
              onChange={(e) => mutate((d) => ({ ...d, name: e.target.value }))}
              className="!h-8 max-w-md !text-base font-semibold"
            />
          ) : (
            "Notebook"
          )
        }
        breadcrumbs={[{ label: "Notebooks", href: "/notebooks" }, { label: notebook.data?.name ?? "" }]}
        actions={
          <>
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
            <Button icon={<Save size={14} />} onClick={save} loading={saving}>
              Save
            </Button>
            <Button variant="primary" icon={<PlaySquare size={14} />} onClick={runAll} loading={runningAll}>
              Run all
            </Button>
          </>
        }
      />

      <div className="px-6">
        {notebook.loading && <Skeleton style={{ height: 240 }} />}
        {notebook.error && <ErrorBanner message={notebook.error} onRetry={notebook.reload} />}

        {draft?.cells.map((cell, index) => {
          const result = results[cell.id];
          return (
            <div key={cell.id} className="mb-4">
              <div className="lh-card overflow-hidden">
                <div
                  className="flex items-center gap-2 px-2 py-1.5"
                  style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}
                >
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    [{index + 1}]
                  </span>
                  <Select
                    value={cell.language}
                    onChange={(value) => mutate((d) => {
                      d.cells[index].language = value as "sql" | "markdown";
                      return d;
                    })}
                    className="w-32"
                    ariaLabel="Cell language"
                    options={[
                      { value: "sql", label: "SQL" },
                      { value: "markdown", label: "Markdown" },
                    ]}
                  />
                  <span className="ml-auto flex items-center gap-0.5">
                    {cell.language === "sql" && (
                      <IconButton title="Run cell" disabled={runningCell === cell.id} onClick={() => runCell(cell)}>
                        {runningCell === cell.id ? <Spinner size={13} /> : <Play size={13} />}
                      </IconButton>
                    )}
                    <IconButton title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                      <ChevronUp size={14} />
                    </IconButton>
                    <IconButton title="Move down" disabled={index === draft.cells.length - 1} onClick={() => move(index, 1)}>
                      <ChevronDown size={14} />
                    </IconButton>
                    <IconButton title="Add cell below" onClick={() => addCell(index)}>
                      <Plus size={14} />
                    </IconButton>
                    <IconButton
                      title="Delete cell"
                      onClick={() => mutate((d) => ({ ...d, cells: d.cells.filter((_, i) => i !== index) }))}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                </div>

                <div className="relative">
                  <AiEditButton
                    value={cell.source}
                    language={cell.language}
                    selection={selections[cell.id]}
                    selectionRect={selRects[cell.id]}
                    onApply={(next) => mutate((d) => {
                      d.cells[index].source = next;
                      return d;
                    })}
                    surface="notebook"
                    floating
                  />
                {cell.language === "sql" ? (
                  <SqlEditor
                    value={cell.source}
                    onChange={(value) => mutate((d) => {
                      d.cells[index].source = value;
                      return d;
                    })}
                    onRun={() => runCell({ ...cell, source: draft.cells[index].source })}
                    onSelectionChange={(s) => {
                      setSelections((prev) => ({ ...prev, [cell.id]: { from: s.from, to: s.to } }));
                      setSelRects((prev) => ({ ...prev, [cell.id]: s.rect }));
                    }}
                    completion={completion}
                    height="auto"
                  />
                ) : (
                  <textarea
                    value={cell.source}
                    onChange={(e) => mutate((d) => {
                      d.cells[index].source = e.target.value;
                      return d;
                    })}
                    onSelect={(e) => {
                      const el = e.currentTarget;
                      setSelections((prev) => ({
                        ...prev,
                        [cell.id]: { from: el.selectionStart, to: el.selectionEnd },
                      }));
                    }}
                    rows={4}
                    placeholder="## Markdown notes"
                    className="w-full resize-y p-3 outline-none"
                    style={{ background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13, border: "none" }}
                  />
                )}
                </div>
              </div>

              {result && (
                <div className="lh-card mt-1 overflow-hidden">
                  {result.status === "FAILED" ? (
                    <pre
                      className="mono overflow-x-auto whitespace-pre-wrap p-3"
                      style={{ fontSize: 12, margin: 0, background: "var(--bg-danger)", color: "var(--text-primary)" }}
                    >
                      {result.error}
                    </pre>
                  ) : result.columns.length === 0 ? (
                    <div className="px-3 py-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Statement completed in {formatDuration(result.duration_ms)} — no result set.
                    </div>
                  ) : (
                    <>
                      <div className="px-3 py-1.5" style={{ fontSize: 12, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                        {formatNumber(result.row_count)} rows · {formatDuration(result.duration_ms)}
                      </div>
                      <ResultTable columns={result.columns} rows={result.rows} maxHeight={300} />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {draft && (
          <Button icon={<Plus size={14} />} onClick={() => addCell(draft.cells.length - 1)}>
            Add cell
          </Button>
        )}
      </div>
    </div>
  );
}
