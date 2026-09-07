"use client";

/** The pieces a task-graph node is made of.
 *
 * Shared by the job editor's Tasks tab and the job run's Graph view so a task
 * looks the same whether you are configuring it or watching it run: a card with
 * a status-coloured top bar, a bold name with a status glyph, and a stack of
 * meta rows (type, source, compute). Conditions grow True/False arms with exit
 * ports; a for-each task is wrapped in a dashed frame.
 */

import {
  Ban,
  CheckCircle2,
  CircleOff,
  Clock,
  Code2,
  Database,
  Folder,
  GitBranch,
  LayoutDashboard,
  Loader2,
  NotebookText,
  Repeat,
  Server,
  SkipForward,
  Waypoints,
  Workflow,
  XCircle,
} from "lucide-react";
import React from "react";

import type { ConditionSpec, RunIf, TaskType } from "@/lib/types";

/* ------------------------------------------------------------------ geometry */

export const CARD_W = 268;
const TOP_BAR = 4;
const PAD_Y = 9;
const TITLE_H = 19;
const ROW_H = 17;
export const ARM_H = 26;
/** Height of the boxed expression row inside a condition card. */
export const COND_ROW_H = 28;

/** Height of a task card with `rows` meta lines under the title.
 *  `bar` accounts for the status stripe that run cards carry and editor cards don't. */
export function cardHeight(rows: number, bar = true): number {
  return (bar ? TOP_BAR : 0) + PAD_Y * 2 + TITLE_H + rows * ROW_H;
}

/** Extra height the True/False arms of a condition add. */
export const ARMS_H = ARM_H * 2 + 1;

/** Exit ports for a condition card of total height `h`. */
export function conditionPorts(h: number) {
  return [
    { id: "true", y: h - ARMS_H + ARM_H / 2 },
    { id: "false", y: h - ARM_H / 2 },
  ];
}

/** Room reserved above a card for the run-if caption. */
export const RUN_IF_PAD = 20;
/** Room reserved around a card for the for-each frame. */
export const FOR_EACH_PAD = { top: 30, side: 14, bottom: 14 };

/* --------------------------------------------------------------------- meta */

export const TASK_TYPE_META: Record<string, { label: string; Icon: React.ComponentType<{ size?: number }> }> = {
  sql: { label: "SQL", Icon: Database },
  notebook: { label: "Notebook", Icon: NotebookText },
  saved_query: { label: "Saved query", Icon: Database },
  dashboard: { label: "Dashboard refresh", Icon: LayoutDashboard },
  condition: { label: "If/else condition", Icon: GitBranch },
  for_each: { label: "For each", Icon: Repeat },
  run_job: { label: "Run job", Icon: Workflow },
  pipeline: { label: "Pipeline", Icon: Waypoints },
};

export function taskTypeMeta(type: TaskType | string) {
  return TASK_TYPE_META[type] ?? { label: String(type), Icon: Folder };
}

/** The dependency rule is shown above the node when it isn't the default. */
export const RUN_IF_LABEL: Record<RunIf, string> = {
  ALL_SUCCESS: "All succeeded",
  ALL_DONE: "All done",
  NONE_FAILED: "None failed",
  AT_LEAST_ONE_SUCCESS: "If at least one succeeded",
  AT_LEAST_ONE_FAILED: "If at least one failed",
  ALL_FAILED: "If all failed",
};

const STATUS_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  SUCCESS: CheckCircle2,
  FAILED: XCircle,
  TIMED_OUT: XCircle,
  UPSTREAM_FAILED: XCircle,
  RUNNING: Loader2,
  QUEUED: Clock,
  PENDING: Clock,
  SKIPPED: SkipForward,
  CANCELED: Ban,
  EXCLUDED: CircleOff,
};

export function StatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  const Icon = STATUS_ICON[status?.toUpperCase()] ?? Clock;
  const spin = status?.toUpperCase() === "RUNNING";
  return <Icon size={size} className={spin ? "lh-spin" : undefined} />;
}

/* -------------------------------------------------------------------- pieces */

/** One meta line inside a card: a small icon and truncated text. */
export function NodeRow({
  icon,
  children,
  title,
  color = "var(--text-secondary)",
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  color?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 overflow-hidden"
      style={{ height: ROW_H, fontSize: 11.5, color }}
      title={title}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="truncate">{children}</span>
    </div>
  );
}

/** The card shell: status bar, border, selection ring. */
export function NodeCard({
  accent,
  selected,
  dashed,
  faded,
  children,
}: {
  /** Colour of the status bar across the top. Omit for an unrun task, which
   *  is drawn as a plain card. */
  accent?: string;
  selected?: boolean;
  dashed?: boolean;
  faded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        borderRadius: 6,
        background: "var(--bg-primary)",
        border: `${selected ? 2 : 1}px ${dashed ? "dashed" : "solid"} ${
          selected ? "var(--action-primary-bg)" : "var(--dag-node-border)"
        }`,
        boxShadow: selected ? "0 0 0 3px var(--action-default-bg-hover)" : "var(--shadow-sm)",
        opacity: faded ? 0.6 : 1,
      }}
    >
      {accent && <div style={{ height: TOP_BAR, background: accent, flexShrink: 0 }} />}
      <div className="flex min-h-0 flex-1 flex-col" style={{ padding: `${PAD_Y}px 10px` }}>{children}</div>
    </div>
  );
}

/** Card title line: name on the left, status glyph on the right. */
export function NodeTitle({
  name,
  right,
  muted,
}: {
  name: string;
  right?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5" style={{ height: TITLE_H }}>
      <span
        className="truncate font-semibold"
        style={{ fontSize: 13.5, color: muted ? "var(--text-secondary)" : "var(--text-primary)" }}
        title={name}
      >
        {name}
      </span>
      {right && <span className="ml-auto flex shrink-0 items-center">{right}</span>}
    </div>
  );
}

/** The True / False arms under a condition, each with an exit port. */
export function ConditionArms({ taken }: { taken?: boolean | null }) {
  const arm = (label: "True" | "False", active: boolean) => (
    <div
      key={label}
      className="relative flex items-center px-2.5"
      style={{
        height: ARM_H,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        borderTop: "1px solid var(--border)",
        background: active ? "var(--text-success)" : "transparent",
        color: active ? "#fff" : "var(--text-primary)",
      }}
    >
      <span className="ml-auto pr-1">{label}</span>
      <span
        className="absolute"
        style={{
          right: -5,
          top: ARM_H / 2 - 4,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "var(--bg-primary)",
          border: `1.5px solid ${active ? "var(--text-success)" : "var(--dag-node-border)"}`,
        }}
      />
    </div>
  );
  return (
    <div className="mt-auto shrink-0" style={{ margin: "0 -10px -9px" }}>
      {arm("True", taken === true)}
      {arm("False", taken === false)}
    </div>
  );
}

/** The dashed frame the graph draws around a for-each task's iteration. */
export function ForEachFrame({ label, top = FOR_EACH_PAD.top - 12 }: { label: string; top?: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        borderRadius: 8,
        border: "1.5px dashed var(--dag-node-border)",
        top,
      }}
    >
      <span
        className="absolute flex items-center gap-1 px-1.5"
        style={{
          left: 10,
          top: -10,
          fontSize: 11,
          color: "var(--text-secondary)",
          background: "var(--dag-canvas-bg)",
        }}
      >
        <Repeat size={11} />
        {label}
      </span>
    </div>
  );
}

/** The small grey caption above a node for a non-default run-if. */
export function RunIfCaption({ text, top = 0 }: { text: string; top?: number }) {
  return (
    <span
      className="pointer-events-none absolute truncate"
      style={{ left: 12, top, fontSize: 11, color: "var(--text-secondary)", maxWidth: CARD_W - 12 }}
    >
      {text}
    </span>
  );
}

/** Compute row — every task node shows what it runs on. */
export function ComputeRow({ name }: { name: string }) {
  return (
    <NodeRow icon={<Server size={11} />} title={name}>
      {name}
    </NodeRow>
  );
}

/** The boxed `{{…}} > 0.9` expression rendered inside a condition node. */
export function ConditionExpression({ condition }: { condition: ConditionSpec | null | undefined }) {
  const box: React.CSSProperties = {
    borderRadius: 3,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-secondary)",
    padding: "1px 5px",
    maxWidth: 92,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div className="flex items-center gap-1" style={{ height: COND_ROW_H, fontSize: 11 }}>
      <Code2 size={12} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
      <span className="mono" style={box} title={condition?.left}>
        {condition?.left || "—"}
      </span>
      <span className="mono shrink-0" style={{ color: "var(--text-secondary)" }}>
        {condition?.op ?? "=="}
      </span>
      <span className="mono" style={box} title={condition?.right}>
        {condition?.right || "—"}
      </span>
    </div>
  );
}
