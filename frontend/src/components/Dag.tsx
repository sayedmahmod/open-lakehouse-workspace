"use client";

/** Pan/zoom task-graph canvas for jobs and pipelines.
 *
 * Layout comes from `layoutDag`; this file owns the viewport (wheel zoom, drag
 * pan), the control stack in the bottom-right corner (search, fit to screen,
 * zoom in, zoom out), the in-canvas search that dims non-matching tasks, the
 * floating "Add task" pill and the per-node hover toolbar.
 */

import { ChevronDown, ChevronUp, Maximize, Minus, Plus, Search, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { layoutDag, type DagInputEdge, type DagInputNode, type DagLaidNode } from "@/lib/dag";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_MAX_ZOOM = 1;
const FIT_PAD = 44;

interface View {
  x: number;
  y: number;
  k: number;
}

interface NodeMeta {
  selected: boolean;
  hovered: boolean;
  /** False while a search is active and this node does not match. */
  matched: boolean;
  laid: DagLaidNode;
}

export interface DagProps<T extends { id: string }> {
  nodes: T[];
  edges: DagInputEdge[];
  renderNode: (node: T, meta: NodeMeta) => React.ReactNode;
  /** Drawn in the node's reserved padding, behind the card — run-if captions, for-each frames. */
  renderDecoration?: (node: T, meta: NodeMeta) => React.ReactNode;
  /** Floating toolbar above the card, shown on hover or while selected. */
  renderNodeToolbar?: (node: T, meta: NodeMeta) => React.ReactNode;
  /** Card size plus any padding reserved for decoration. */
  nodeBox?: (node: T) => Omit<DagInputNode, "id">;
  /** Text the in-canvas search matches against. Defaults to the node id. */
  searchText?: (node: T) => string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  height?: number;
  edgeColor?: (edge: DagInputEdge) => string;
  emptyLabel?: string;
  /** Renders the centered "Add task" pill floating over the canvas. */
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
}

export function Dag<T extends { id: string }>({
  nodes,
  edges,
  renderNode,
  renderDecoration,
  renderNodeToolbar,
  nodeBox,
  searchText,
  selectedId,
  onSelect,
  height = 460,
  edgeColor,
  emptyLabel = "No tasks yet",
  onAdd,
  addLabel = "Add task",
  className,
}: DagProps<T>) {
  const layout = useMemo(
    () =>
      layoutDag(
        nodes.map((n) => ({ id: n.id, ...(nodeBox ? nodeBox(n) : {}) })),
        edges,
      ),
    [nodes, edges, nodeBox],
  );
  const laidById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [ready, setReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  /* ------------------------------------------------------------------ search */

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => (searchText ? searchText(n) : n.id).toLowerCase().includes(q)).map((n) => n.id);
  }, [nodes, query, searchText]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const searching = query.trim().length > 0;

  /* ------------------------------------------------------- viewport controls */

  const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || layout.width === 0 || el.clientWidth === 0) return;
    const kx = (el.clientWidth - FIT_PAD * 2) / layout.width;
    const ky = (el.clientHeight - FIT_PAD * 2) / layout.height;
    const k = clampZoom(Math.min(FIT_MAX_ZOOM, kx, ky));
    setView({
      k,
      x: (el.clientWidth - layout.width * k) / 2,
      y: (el.clientHeight - layout.height * k) / 2,
    });
    setReady(true);
  }, [layout.width, layout.height]);

  useEffect(() => {
    fit();
    // Re-fit only when the graph's extent changes, not on every view tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width, layout.height]);

  // Keep the graph framed when the canvas itself is resized (sidebar, window).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      if (k === v.k) return v;
      return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
    });
  }, []);

  const zoomCenter = (dir: 1 | -1) => {
    const el = wrapRef.current;
    zoomAt((el?.clientWidth ?? 0) / 2, (el?.clientHeight ?? 0) / 2, dir === 1 ? 1.25 : 1 / 1.25);
  };

  /** Pan so a node sits in the middle of the canvas, keeping the current zoom. */
  const centerOn = useCallback(
    (id: string) => {
      const el = wrapRef.current;
      const laid = laidById.get(id);
      if (!el || !laid) return;
      setView((v) => ({
        ...v,
        x: el.clientWidth / 2 - (laid.x + laid.w / 2) * v.k,
        y: el.clientHeight / 2 - (laid.y + laid.h / 2) * v.k,
      }));
    },
    [laidById],
  );

  const activeMatch = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : null;

  // Follow the active search hit. Guarded by a ref: `centerOn` closes over the
  // layout, so without it panning would re-run this effect and pan again.
  const centered = useRef<string | null>(null);
  useEffect(() => {
    if (!activeMatch) {
      centered.current = null;
      return;
    }
    if (centered.current === activeMatch) return;
    centered.current = activeMatch;
    centerOn(activeMatch);
  }, [activeMatch, centerOn]);

  /* ------------------------------------------------------------- interaction */

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Trackpad two-finger scroll pans; pinch (ctrlKey) and wheel zoom.
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1) {
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-dag-chrome]")) return;
    if (target.closest("[data-dag-node]")) return;
    target.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    // A click on empty canvas (no drag) clears the selection.
    if (drag.current && !drag.current.moved) onSelect?.(null);
    drag.current = null;
    setPanning(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "+" || e.key === "=") zoomCenter(1);
    else if (e.key === "-" || e.key === "_") zoomCenter(-1);
    else if (e.key === "0") fit();
    else if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      openSearch();
    } else return;
    e.preventDefault();
  };

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };
  const stepMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    setMatchIndex((i) => (i + dir + matches.length) % matches.length);
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`dag-canvas relative overflow-hidden outline-none select-none ${className ?? ""}`}
      style={{
        height,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--dag-canvas-bg)",
        cursor: panning ? "grabbing" : "grab",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {nodes.length === 0 && !onAdd && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: 13, color: "var(--text-secondary)" }}
        >
          {emptyLabel}
        </div>
      )}

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          width: layout.width,
          height: layout.height,
          opacity: ready ? 1 : 0,
          transition: "opacity 120ms ease",
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          <defs>
            <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--dag-edge)" />
            </marker>
            <marker
              id="dag-arrow-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="var(--dag-edge-strong)" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            const touchesSelection = selectedId === e.source || selectedId === e.target;
            const touchesHover = hoveredId === e.source || hoveredId === e.target;
            const active = touchesSelection || touchesHover;
            const color = active ? "var(--dag-edge-strong)" : edgeColor ? edgeColor(e) : "var(--dag-edge)";
            const dimmed = searching && !(matchSet.has(e.source) && matchSet.has(e.target));
            return (
              <g key={`${e.source}->${e.target}-${e.outcome ?? ""}-${i}`} opacity={dimmed ? 0.25 : 1}>
                <path
                  d={e.path}
                  fill="none"
                  stroke={color}
                  strokeWidth={active ? 2 : 1.5}
                  markerEnd={`url(#${active ? "dag-arrow-active" : "dag-arrow"})`}
                />
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => {
          const laid = laidById.get(node.id);
          if (!laid) return null;
          const selected = selectedId === node.id;
          const hovered = hoveredId === node.id;
          const matched = !searching || matchSet.has(node.id);
          const meta: NodeMeta = { selected, hovered, matched, laid };
          const isActiveMatch = searching && activeMatch === node.id;

          return (
            <div
              key={node.id}
              data-dag-node
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId((h) => (h === node.id ? null : h))}
              className="absolute"
              style={{
                left: laid.outerX,
                top: laid.outerY,
                width: laid.outerW,
                height: laid.outerH,
                opacity: matched ? 1 : 0.28,
                transition: "opacity 120ms ease",
                zIndex: selected || hovered ? 3 : 1,
              }}
            >
              {renderDecoration?.(node, meta)}

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(node.id);
                }}
                className="absolute"
                style={{
                  left: laid.padLeft,
                  top: laid.padTop,
                  width: laid.w,
                  height: laid.h,
                  cursor: onSelect ? "pointer" : "default",
                  borderRadius: 6,
                  boxShadow: isActiveMatch ? "0 0 0 3px var(--action-primary-bg-hover)" : undefined,
                }}
              >
                {renderNode(node, meta)}
              </div>

              {renderNodeToolbar && (selected || hovered) && (
                <div
                  data-dag-chrome
                  className="absolute flex items-center gap-0.5 rounded-[6px] p-0.5"
                  style={{
                    left: laid.padLeft + laid.w / 2,
                    top: laid.padTop - 36,
                    transform: "translateX(-50%)",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-strong)",
                    boxShadow: "var(--shadow-md)",
                    zIndex: 4,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {renderNodeToolbar(node, meta)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating "Add task" pill, centered over the canvas. */}
      {onAdd && (
        <button
          type="button"
          data-dag-chrome
          onClick={onAdd}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-1/2 flex items-center gap-1.5 rounded-full px-4 font-medium"
          style={{
            bottom: nodes.length === 0 ? "auto" : 18,
            top: nodes.length === 0 ? "50%" : "auto",
            transform: nodes.length === 0 ? "translate(-50%, -50%)" : "translateX(-50%)",
            height: 36,
            fontSize: 13,
            background: "var(--action-primary-bg)",
            color: "var(--action-primary-text)",
            border: "1px solid transparent",
            boxShadow: "var(--shadow-md)",
            zIndex: 5,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--action-primary-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--action-primary-bg)";
          }}
        >
          <Plus size={15} />
          {addLabel}
        </button>
      )}

      {/* Control stack: search, fit to screen, zoom in, zoom out. */}
      <div
        data-dag-chrome
        className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-1.5"
        style={{ zIndex: 6 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <CanvasButton title="Search tasks" active={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())}>
          <Search size={14} />
        </CanvasButton>
        <CanvasButton title="Fit to screen" onClick={fit}>
          <Maximize size={14} />
        </CanvasButton>
        <CanvasButton title="Zoom in" onClick={() => zoomCenter(1)} disabled={view.k >= MAX_ZOOM}>
          <Plus size={14} />
        </CanvasButton>
        <CanvasButton title="Zoom out" onClick={() => zoomCenter(-1)} disabled={view.k <= MIN_ZOOM}>
          <Minus size={14} />
        </CanvasButton>
      </div>

      {searchOpen && (
        <div
          data-dag-chrome
          className="absolute right-14 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-[6px] px-1.5"
          style={{
            height: 34,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-md)",
            zIndex: 6,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Search size={13} style={{ color: "var(--text-secondary)" }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1);
            }}
            placeholder="Search tasks"
            className="w-40 bg-transparent outline-none"
            style={{ fontSize: 13, color: "var(--text-primary)" }}
          />
          {searching && (
            <span className="whitespace-nowrap" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {matches.length === 0 ? "0 results" : `${matchIndex + 1}/${matches.length}`}
            </span>
          )}
          <button
            type="button"
            title="Previous match"
            onClick={() => stepMatch(-1)}
            disabled={matches.length === 0}
            className="flex h-6 w-6 items-center justify-center rounded-[4px] disabled:opacity-30"
            style={{ color: "var(--action-icon-default)" }}
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            title="Next match"
            onClick={() => stepMatch(1)}
            disabled={matches.length === 0}
            className="flex h-6 w-6 items-center justify-center rounded-[4px] disabled:opacity-30"
            style={{ color: "var(--action-icon-default)" }}
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            title="Close search"
            onClick={closeSearch}
            className="flex h-6 w-6 items-center justify-center rounded-[4px]"
            style={{ color: "var(--action-icon-default)" }}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function CanvasButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors disabled:opacity-40"
      style={{
        background: active ? "var(--action-default-bg-hover)" : "var(--bg-primary)",
        border: "1px solid var(--border-strong)",
        color: active ? "var(--link)" : "var(--action-icon-default)",
        boxShadow: "var(--shadow-sm)",
      }}
      onMouseEnter={(e) => {
        if (e.currentTarget.disabled) return;
        e.currentTarget.style.borderColor = "var(--action-default-border-hover)";
        e.currentTarget.style.color = "var(--action-icon-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
        e.currentTarget.style.color = active ? "var(--link)" : "var(--action-icon-default)";
      }}
    >
      {children}
    </button>
  );
}
