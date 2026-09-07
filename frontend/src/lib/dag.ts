/** Layered left-to-right layout for a small task / dataset DAG.
 *
 * Ranks nodes by longest path from a root, orders each rank with a couple of
 * barycentre sweeps to take the obvious crossings out, and returns absolute
 * positions plus cubic-bezier edge paths. Good enough for the tens-of-nodes
 * graphs a workflow or a pipeline actually has; no external layout engine.
 *
 * A node has two rects: the *card* (x, y, w, h) that edges attach to, and the
 * *outer* box that also covers whatever decoration sits around the card — the
 * "If at least one succeeded" caption above a task, or the dashed frame the
 * task graph draws around a for-each iteration.
 */

export interface DagPort {
  /** Matches an edge's `outcome`. */
  id: string;
  /** Offset from the top of the card. */
  y: number;
}

export interface DagInputNode {
  id: string;
  /** Optional explicit card size; defaults to NODE_W x NODE_H. */
  w?: number;
  h?: number;
  /** Room reserved around the card for decoration. */
  padTop?: number;
  padLeft?: number;
  padRight?: number;
  padBottom?: number;
  /** Named exit points on the right edge, e.g. the true/false arms of a condition. */
  ports?: DagPort[];
}

export interface DagInputEdge {
  source: string;
  target: string;
  outcome?: string;
}

export interface DagLaidNode {
  id: string;
  /** Card rect — what edges attach to and what `renderNode` fills. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Outer rect, card plus its reserved padding. */
  outerX: number;
  outerY: number;
  outerW: number;
  outerH: number;
  padTop: number;
  padLeft: number;
  layer: number;
  ports?: DagPort[];
}

export interface DagLaidEdge {
  source: string;
  target: string;
  outcome?: string;
  path: string;
  /** Mid-point, for an outcome label. */
  labelX: number;
  labelY: number;
}

export interface DagLayout {
  nodes: DagLaidNode[];
  edges: DagLaidEdge[];
  width: number;
  height: number;
}

export const NODE_W = 244;
export const NODE_H = 96;
const GAP_X = 88;
const GAP_Y = 28;
const PAD = 40;

export function layoutDag(
  inputNodes: DagInputNode[],
  inputEdges: DagInputEdge[],
): DagLayout {
  const nodes = inputNodes.filter(Boolean);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = new Set(byId.keys());
  const edges = inputEdges.filter((e) => ids.has(e.source) && ids.has(e.target));

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const id of ids) {
    parents.set(id, []);
    children.set(id, []);
  }
  for (const e of edges) {
    parents.get(e.target)!.push(e.source);
    children.get(e.source)!.push(e.target);
  }

  // Longest-path layering (cycle-safe via a visited guard).
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const rank = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents.get(id)!;
    const value = ps.length === 0 ? 0 : Math.max(...ps.map((p) => rank(p) + 1));
    visiting.delete(id);
    layer.set(id, value);
    return value;
  };
  for (const n of nodes) rank(n.id);

  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n.id);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);

  // Barycentre sweeps (down, then up) to reduce crossings.
  const orderIndex = new Map<string, number>();
  for (const l of layers) byLayer.get(l)!.forEach((id, i) => orderIndex.set(id, i));
  const sweep = (from: "parents" | "children") => {
    const rows = from === "parents" ? layers.slice(1) : [...layers].reverse().slice(1);
    for (const l of rows) {
      const row = byLayer.get(l)!;
      const neighbours = from === "parents" ? parents : children;
      row.sort((a, b) => bary(a, neighbours) - bary(b, neighbours));
      row.forEach((id, i) => orderIndex.set(id, i));
    }
  };
  function bary(id: string, neighbours: Map<string, string[]>): number {
    const ns = neighbours.get(id)!;
    if (ns.length === 0) return orderIndex.get(id) ?? 0;
    return ns.reduce((sum, p) => sum + (orderIndex.get(p) ?? 0), 0) / ns.length;
  }
  sweep("parents");
  sweep("children");
  sweep("parents");

  const boxOf = (id: string) => {
    const n = byId.get(id)!;
    const w = n.w ?? NODE_W;
    const h = n.h ?? NODE_H;
    const padTop = n.padTop ?? 0;
    const padLeft = n.padLeft ?? 0;
    const padRight = n.padRight ?? 0;
    const padBottom = n.padBottom ?? 0;
    return { w, h, padTop, padLeft, padRight, padBottom, outerW: w + padLeft + padRight, outerH: h + padTop + padBottom };
  };

  // Assign coordinates. Each layer is a column; stack its nodes vertically.
  const laid = new Map<string, DagLaidNode>();
  let x = PAD;
  let maxBottom = PAD;
  for (const l of layers) {
    const row = byLayer.get(l)!;
    const colW = Math.max(...row.map((id) => boxOf(id).outerW));
    let y = PAD;
    for (const id of row) {
      const b = boxOf(id);
      // Centre the card in the column so mixed-width layers stay aligned.
      const outerX = x + (colW - b.outerW) / 2;
      laid.set(id, {
        id,
        x: outerX + b.padLeft,
        y: y + b.padTop,
        w: b.w,
        h: b.h,
        outerX,
        outerY: y,
        outerW: b.outerW,
        outerH: b.outerH,
        padTop: b.padTop,
        padLeft: b.padLeft,
        layer: l,
        ports: byId.get(id)!.ports,
      });
      y += b.outerH + GAP_Y;
      maxBottom = Math.max(maxBottom, y);
    }
    x += colW + GAP_X;
  }

  // Vertically centre each column against the tallest one.
  const contentHeight = maxBottom - PAD - GAP_Y;
  for (const l of layers) {
    const row = byLayer.get(l)!;
    const rowHeight = row.reduce((sum, id) => sum + boxOf(id).outerH + GAP_Y, -GAP_Y);
    const offset = Math.max(0, (contentHeight - rowHeight) / 2);
    for (const id of row) {
      const n = laid.get(id)!;
      n.y += offset;
      n.outerY += offset;
    }
  }

  const laidEdges: DagLaidEdge[] = edges.map((e) => {
    const s = laid.get(e.source)!;
    const t = laid.get(e.target)!;
    const port = e.outcome ? s.ports?.find((p) => p.id === e.outcome) : undefined;
    const x1 = s.x + s.w;
    const y1 = port ? s.y + port.y : s.y + s.h / 2;
    const x2 = t.x;
    const y2 = t.y + t.h / 2;
    // Flatten the handles when the gap is wide so long edges stay readable.
    const dx = Math.max(28, Math.min(90, (x2 - x1) / 2));
    return {
      source: e.source,
      target: e.target,
      outcome: e.outcome,
      path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2 - 6,
    };
  });

  return {
    nodes: [...laid.values()],
    edges: laidEdges,
    width: x - GAP_X + PAD,
    height: contentHeight + PAD * 2,
  };
}
