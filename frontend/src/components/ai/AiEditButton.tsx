"use client";

/** The sparkle: AI rewrite of an editor cell — whole cell or just the current
 *  selection — streamed live as a diff you accept or reject. Shared by the SQL
 *  editor and notebook cells. The model is a local CLI (Claude Code / Codex),
 *  reached through the workspace API's streamed /ai/edit endpoint. */
import { Sparkles } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button, IconButton, Modal, SegmentedControl, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { diffLines } from "@/lib/diff";
import type { AiStatus } from "@/lib/types";

type Mode = "whole" | "selection";

interface Selection {
  from: number;
  to: number;
}

// One status fetch is enough for a page full of cells — cache it briefly.
let statusCache: { at: number; value: AiStatus } | null = null;
async function getStatus(): Promise<AiStatus> {
  if (statusCache && Date.now() - statusCache.at < 10_000) return statusCache.value;
  const value = await api.ai.status();
  statusCache = { at: Date.now(), value };
  return value;
}

export function AiEditButton({
  value,
  language,
  selection,
  selectionRect,
  onApply,
  surface,
  context,
  disabled,
  floating,
}: {
  value: string;
  language: string;
  selection?: Selection;
  /** Viewport position just above the current selection, for the pop-up trigger. */
  selectionRect?: { top: number; left: number } | null;
  onApply: (next: string) => void;
  surface: string;
  context?: { tables: string[] };
  disabled?: boolean;
  /** Render as a chip overlaid in the top-right corner of the editor field. */
  floating?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const hasSelection = !!selection && selection.to > selection.from;

  const apply = (next: string) => {
    onApply(next);
    setOpen(false);
    toast("AI edit applied", "success");
  };

  return (
    <>
      <span
        className={floating ? "absolute right-1.5 top-1.5 z-20 inline-flex" : "relative inline-flex"}
        style={
          floating
            ? { background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 4 }
            : undefined
        }
      >
        <IconButton title="Edit with AI" active={open} disabled={disabled} onClick={() => setOpen(true)}>
          <Sparkles size={14} />
        </IconButton>
      </span>

      {/* Floating trigger that follows a text selection inside the editor. */}
      {!open && hasSelection && selectionRect && typeof document !== "undefined"
        ? createPortal(
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 shadow-lg"
              style={{
                position: "fixed",
                top: Math.max(4, selectionRect.top - 34),
                left: selectionRect.left,
                zIndex: 60,
                fontSize: 12,
                fontWeight: 600,
                background: "var(--action-primary-bg)",
                color: "var(--action-primary-text)",
                border: "1px solid transparent",
              }}
            >
              <Sparkles size={12} />
              Edit with AI
            </button>,
            document.body,
          )
        : null}

      {open && (
        <AiEditModal
          value={value}
          language={language}
          selection={selection}
          hasSelection={hasSelection}
          surface={surface}
          context={context}
          onClose={() => setOpen(false)}
          onApply={apply}
        />
      )}
    </>
  );
}

function AiEditModal({
  value,
  language,
  selection,
  hasSelection,
  surface,
  context,
  onClose,
  onApply,
}: {
  value: string;
  language: string;
  selection?: Selection;
  hasSelection: boolean;
  surface: string;
  context?: { tables: string[] };
  onClose: () => void;
  onApply: (next: string) => void;
}) {
  const [status, setStatus] = useState<AiStatus | null>(statusCache?.value ?? null);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<Mode>(hasSelection ? "selection" : "whole");
  const [phase, setPhase] = useState<"prompt" | "streaming" | "review">("prompt");
  const [streamed, setStreamed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => {});
    inputRef.current?.focus();
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const active = status?.providers.find((p) => p.id === status.active.provider);
  const ready = !!active?.available;

  const before = value;
  const after =
    mode === "selection" && selection
      ? value.slice(0, selection.from) + streamed + value.slice(selection.to)
      : streamed;

  const run = () => {
    setPhase("streaming");
    setStreamed("");
    setError(null);
    controllerRef.current = api.ai.edit(
      {
        source: value,
        language,
        instruction,
        context,
        selection:
          mode === "selection" && selection ? { start: selection.from, end: selection.to } : undefined,
        surface,
      },
      {
        onDelta: (t) => setStreamed((s) => s + t),
        onDone: (output) => {
          setStreamed(output);
          setPhase("review");
        },
        onError: (message) => {
          setError(message);
          setPhase("prompt");
        },
      },
    );
  };

  const stop = () => {
    controllerRef.current?.abort();
    setPhase("prompt");
  };

  const close = () => {
    controllerRef.current?.abort();
    onClose();
  };

  const footer =
    phase === "streaming" ? (
      <Button onClick={stop} icon={<Spinner size={13} />}>
        Stop
      </Button>
    ) : phase === "review" ? (
      <>
        <Button onClick={() => setPhase("prompt")}>Reject</Button>
        <Button variant="primary" onClick={() => onApply(after)}>
          Accept
        </Button>
      </>
    ) : (
      <>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          icon={<Sparkles size={13} />}
          disabled={!instruction.trim() || !ready}
          onClick={run}
          title="Generate (⌘↵)"
        >
          Generate
        </Button>
      </>
    );

  return (
    <Modal open onClose={close} title="Edit with AI" width={920} footer={footer}>
      {status && !ready ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          No AI CLI detected.{" "}
          <Link href="/settings" style={{ color: "var(--link)" }} onClick={close}>
            Set one up in Settings
          </Link>
          .
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            <SegmentedControl
              size="sm"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { value: "whole", label: "Whole cell" },
                {
                  value: "selection",
                  label: "Selection",
                  title: hasSelection ? undefined : "Select text in the cell first",
                },
              ].filter((o) => o.value === "whole" || hasSelection)}
            />
            <span className="ml-auto">
              {active?.name ?? status?.active.provider}
              {status?.active.model ? ` · ${status.active.model}` : ""}
              {status?.active.reasoning_effort ? ` · ${status.active.reasoning_effort} effort` : ""}
            </span>
          </div>

          <textarea
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && instruction.trim() && phase === "prompt") {
                e.preventDefault();
                run();
              }
            }}
            rows={3}
            placeholder={mode === "selection" ? "Change the selection to…" : "Rewrite this cell to…"}
            className="w-full resize-y rounded-[4px] p-2.5 outline-none"
            style={{
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              border: "1px solid var(--action-default-border)",
              fontSize: 13,
              minHeight: 72,
            }}
          />

          {error && (
            <div style={{ fontSize: 12, color: "var(--text-danger)" }}>{error}</div>
          )}

          {phase !== "prompt" && (
            <div>
              <div
                className="mb-1 flex items-center gap-1.5"
                style={{ fontSize: 11, color: "var(--text-secondary)" }}
              >
                {phase === "streaming" ? <Spinner size={11} /> : <Sparkles size={11} />}
                {phase === "streaming" ? "Generating…" : "Proposed change"}
              </div>
              <DiffView before={before} after={after} streaming={phase === "streaming"} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DiffView({
  before,
  after,
  streaming,
}: {
  before: string;
  after: string;
  streaming?: boolean;
}) {
  const rows = diffLines(before, after);
  const unchanged = before === after;
  return (
    <pre
      className="mono overflow-auto rounded-[4px]"
      style={{
        fontSize: 12,
        border: "1px solid var(--border)",
        margin: 0,
        maxHeight: "48vh",
        minHeight: 160,
      }}
    >
      {unchanged && !streaming ? (
        <div style={{ padding: "8px", color: "var(--text-secondary)" }}>
          The AI returned the cell unchanged.
        </div>
      ) : (
        rows.map((row, i) => (
          <div
            key={i}
            style={{
              padding: "0 8px",
              whiteSpace: "pre-wrap",
              background:
                row.type === "add"
                  ? "var(--bg-success)"
                  : row.type === "del"
                    ? "var(--bg-danger)"
                    : "transparent",
              color: row.type === "same" ? "var(--text-secondary)" : "var(--text-primary)",
            }}
          >
            <span style={{ userSelect: "none", opacity: 0.5 }}>
              {row.type === "add" ? "+ " : row.type === "del" ? "- " : "  "}
            </span>
            {row.text || " "}
          </div>
        ))
      )}
      {streaming && <span style={{ opacity: 0.5, padding: "0 8px" }}>▍</span>}
    </pre>
  );
}
