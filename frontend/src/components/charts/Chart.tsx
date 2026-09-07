"use client";

/** Dashboard chart marks.
 *
 * Built to the project's data-viz rules: one axis only, a categorical palette
 * assigned in fixed order (never cycled past slot 8), thin marks with 4px
 * rounded data-ends, 2px lines, a 2px surface gap between adjacent fills,
 * recessive grid and axes, a legend whenever two or more series are drawn,
 * text in ink tokens rather than series colours, a hover tooltip on every
 * plotted form, and a table view — which is also the relief for the three
 * light-mode palette slots that sit under 3:1 contrast.
 */
import React, { useMemo, useRef, useState } from "react";

import { formatCell, formatCompact } from "@/lib/format";

export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

/** Categorical hues are assigned in fixed order and never cycled: past eight
 *  series the extras fold into a neutral "Other" rather than reusing a hue. */
export function seriesColor(index: number): string {
  return index < SERIES_VARS.length ? SERIES_VARS[index] : "var(--text-secondary)";
}

export interface ChartDatum {
  label: string;
  values: number[];
}

interface ChartProps {
  type: "bar" | "line" | "area" | "pie";
  data: ChartDatum[];
  seriesNames: string[];
  height?: number;
  valueFormat?: (value: number) => string;
}

const PAD = { top: 16, right: 16, bottom: 32, left: 52 };

function niceTicks(max: number, min: number, count = 4): number[] {
  if (!Number.isFinite(max) || !Number.isFinite(min)) return [0, 1];
  if (max === min) return [min, min + 1];
  const span = max - min;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Legend — always rendered for two or more series so identity never rests on
 *  colour alone. A single series is named by the widget title instead. */
function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 pt-2">
      {names.map((name, i) => (
        <span key={name} className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          <span
            aria-hidden
            style={{ width: 10, height: 10, borderRadius: 2, background: seriesColor(i), display: "inline-block" }}
          />
          {name}
        </span>
      ))}
    </div>
  );
}

interface Hover {
  x: number;
  y: number;
  title: string;
  entries: { name: string; value: number; color: string }[];
}

function Tooltip({ hover, format }: { hover: Hover; format: (v: number) => string }) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-[4px] px-2 py-1.5"
      style={{
        left: hover.x,
        top: hover.y,
        transform: "translate(-50%, -100%)",
        background: "var(--bg-primary)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-md)",
        minWidth: 110,
      }}
    >
      <div className="mb-1 font-medium" style={{ fontSize: 12, color: "var(--text-primary)" }}>
        {hover.title}
      </div>
      {hover.entries.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-3" style={{ fontSize: 12 }}>
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, display: "inline-block" }} />
            {entry.name}
          </span>
          <span style={{ color: "var(--text-primary)" }}>{format(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Chart({ type, data, seriesNames, height = 260, valueFormat = formatCompact }: ChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<Hover | null>(null);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(240, w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (type === "pie") {
    return (
      <div ref={wrapRef} className="relative">
        <PieChart data={data} height={height} valueFormat={valueFormat} />
      </div>
    );
  }

  const innerW = Math.max(40, width - PAD.left - PAD.right);
  const innerH = Math.max(40, height - PAD.top - PAD.bottom);

  const flat = data.flatMap((d) => d.values.filter((v) => Number.isFinite(v)));
  const rawMax = flat.length ? Math.max(...flat) : 1;
  const rawMin = flat.length ? Math.min(...flat, 0) : 0;
  const ticks = niceTicks(rawMax, rawMin);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yScale = (v: number) => innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const count = data.length || 1;
  const bandWidth = innerW / count;

  // Show at most ~10 x labels so they never collide.
  const labelStep = Math.max(1, Math.ceil(count / 10));

  return (
    <div ref={wrapRef} className="relative">
      <svg width={width} height={height} role="img" aria-label={`${type} chart`} style={{ display: "block" }}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Recessive gridlines and value axis */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={innerW} y1={yScale(tick)} y2={yScale(tick)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text
                x={-8}
                y={yScale(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                style={{ fontSize: 11, fill: "var(--chart-axis)" }}
              >
                {valueFormat(tick)}
              </text>
            </g>
          ))}

          {type === "bar" &&
            data.map((datum, di) => {
              const groupW = bandWidth * 0.7;
              const barW = Math.max(2, groupW / seriesNames.length - 2); // 2px surface gap between adjacent bars
              const groupX = di * bandWidth + (bandWidth - groupW) / 2;
              return datum.values.map((value, si) => {
                if (!Number.isFinite(value)) return null;
                const zero = yScale(Math.max(0, yMin));
                const top = yScale(value);
                const h = Math.abs(zero - top);
                const y = Math.min(zero, top);
                const r = Math.min(4, barW / 2, h);
                return (
                  <path
                    key={`${di}-${si}`}
                    /* Rounded only on the data end; the baseline end stays square. */
                    d={`M${groupX + si * (barW + 2)},${y + h}
                        L${groupX + si * (barW + 2)},${y + r}
                        Q${groupX + si * (barW + 2)},${y} ${groupX + si * (barW + 2) + r},${y}
                        L${groupX + si * (barW + 2) + barW - r},${y}
                        Q${groupX + si * (barW + 2) + barW},${y} ${groupX + si * (barW + 2) + barW},${y + r}
                        L${groupX + si * (barW + 2) + barW},${y + h} Z`}
                    fill={seriesColor(si)}
                    onMouseEnter={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      setHover({
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0) - 8,
                        title: datum.label,
                        entries: [{ name: seriesNames[si], value, color: seriesColor(si) }],
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              });
            })}

          {(type === "line" || type === "area") &&
            seriesNames.map((name, si) => {
              const points = data
                .map((datum, di) => ({ x: di * bandWidth + bandWidth / 2, y: yScale(datum.values[si]), v: datum.values[si] }))
                .filter((p) => Number.isFinite(p.v));
              if (points.length === 0) return null;
              const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
              const baseline = yScale(Math.max(0, yMin));
              return (
                <g key={name}>
                  {type === "area" && (
                    <path
                      d={`${path} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`}
                      fill={seriesColor(si)}
                      opacity={0.16}
                    />
                  )}
                  <path d={path} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {/* Markers get a 2px surface ring so overlapping series stay legible. */}
                  {points.length <= 40 &&
                    points.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={4} fill={seriesColor(si)} stroke="var(--bg-primary)" strokeWidth={2} />
                    ))}
                </g>
              );
            })}

          {/* Crosshair + shared tooltip band for line and area */}
          {(type === "line" || type === "area") &&
            data.map((datum, di) => {
              const cx = di * bandWidth + bandWidth / 2;
              return (
                <rect
                  key={di}
                  x={di * bandWidth}
                  y={0}
                  width={bandWidth}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={(e) => {
                    const rect = wrapRef.current?.getBoundingClientRect();
                    setHover({
                      x: cx + PAD.left,
                      y: e.clientY - (rect?.top ?? 0) - 8,
                      title: datum.label,
                      entries: seriesNames
                        .map((name, si) => ({ name, value: datum.values[si], color: seriesColor(si) }))
                        .filter((entry) => Number.isFinite(entry.value)),
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}

          {/* Category axis */}
          <line x1={0} x2={innerW} y1={yScale(Math.max(0, yMin))} y2={yScale(Math.max(0, yMin))} stroke="var(--chart-axis)" strokeWidth={1} opacity={0.4} />
          {data.map((datum, di) =>
            di % labelStep === 0 ? (
              <text
                key={di}
                x={di * bandWidth + bandWidth / 2}
                y={innerH + 16}
                textAnchor="middle"
                style={{ fontSize: 11, fill: "var(--chart-axis)" }}
              >
                {datum.label.length > 14 ? `${datum.label.slice(0, 13)}…` : datum.label}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      <Legend names={seriesNames} />
      {hover && <Tooltip hover={hover} format={valueFormat} />}
    </div>
  );
}

function PieChart({
  data,
  height,
  valueFormat,
}: {
  data: ChartDatum[];
  height: number;
  valueFormat: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const size = height;
  const radius = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;

  const slices = useMemo(() => {
    const total = data.reduce((sum, d) => sum + (Number.isFinite(d.values[0]) ? Math.max(0, d.values[0]) : 0), 0);
    if (total <= 0) return [];
    let angle = -Math.PI / 2;
    return data.map((datum, i) => {
      const value = Math.max(0, datum.values[0] ?? 0);
      const sweep = (value / total) * Math.PI * 2;
      const start = angle;
      angle += sweep;
      return { label: datum.label, value, pct: (value / total) * 100, start, end: angle, index: i };
    });
  }, [data]);

  if (slices.length === 0) {
    return (
      <div className="px-4 py-10 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        No positive values to chart.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} role="img" aria-label="Pie chart">
        {slices.map((slice) => {
          const large = slice.end - slice.start > Math.PI ? 1 : 0;
          const x1 = cx + radius * Math.cos(slice.start);
          const y1 = cy + radius * Math.sin(slice.start);
          const x2 = cx + radius * Math.cos(slice.end);
          const y2 = cy + radius * Math.sin(slice.end);
          return (
            <path
              key={slice.label}
              d={`M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z`}
              fill={seriesColor(slice.index)}
              /* 2px surface gap keeps adjacent slices separated. */
              stroke="var(--bg-primary)"
              strokeWidth={2}
              opacity={hover === null || hover === slice.index ? 1 : 0.45}
              onMouseEnter={() => setHover(slice.index)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        {slices.map((slice) => (
          <div
            key={slice.label}
            className="flex items-center gap-2"
            style={{ fontSize: 12, opacity: hover === null || hover === slice.index ? 1 : 0.5 }}
            onMouseEnter={() => setHover(slice.index)}
            onMouseLeave={() => setHover(null)}
          >
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: seriesColor(slice.index) }} />
            <span className="truncate" style={{ color: "var(--text-secondary)", maxWidth: 160 }}>
              {slice.label}
            </span>
            <span style={{ color: "var(--text-primary)" }}>
              {valueFormat(slice.value)} · {slice.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single headline number — the form to use when the data is one value. */
export function Counter({
  value,
  label,
  sublabel,
}: {
  value: string;
  label?: string;
  sublabel?: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center px-2 py-4">
      <div className="font-semibold" style={{ fontSize: 40, lineHeight: "48px", color: "var(--text-primary)" }}>
        {value}
      </div>
      {label && (
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {label}
        </div>
      )}
      {sublabel && (
        <div className="mt-0.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

/** Plain table rendering of a result set — a widget type in its own right and
 *  the accessible fallback every chart can switch to. */
export function ResultTable({
  columns,
  rows,
  maxHeight = 320,
}: {
  columns: { name: string; type?: string }[];
  rows: unknown[][];
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse" style={{ fontSize: 12 }}>
        <thead className="sticky top-0 z-10">
          <tr style={{ background: "var(--table-header-bg)" }}>
            {columns.map((col) => (
              <th
                key={col.name}
                className="px-2 py-1.5 text-left font-medium"
                style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: "1px solid var(--border)" }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="mono px-2 py-1"
                  style={{
                    color: cell === null ? "var(--text-secondary)" : "var(--text-primary)",
                    fontStyle: cell === null ? "italic" : "normal",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
