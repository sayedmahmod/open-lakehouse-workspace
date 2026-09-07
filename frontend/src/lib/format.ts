/** Formatting helpers shared across tables, cards and charts. */

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value * 100) / 100);
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatMB(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return "—";
  return formatBytes(mb * 1024 * 1024);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Absolute timestamp, e.g. "Sep 7, 2026, 01:43". */
export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Relative timestamp, e.g. "4 minutes ago". */
export function formatRelative(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const sign = diff > 0 ? -1 : 1;
  if (abs < minute) return rtf.format(sign * Math.round(abs / 1000), "second");
  if (abs < hour) return rtf.format(sign * Math.round(abs / minute), "minute");
  if (abs < day) return rtf.format(sign * Math.round(abs / hour), "hour");
  if (abs < 30 * day) return rtf.format(sign * Math.round(abs / day), "day");
  return formatDateTime(value);
}

/** Render a value coming out of a Spark result grid. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function isNumeric(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when a Spark type string denotes a number. */
export function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  return /^(int|long|short|byte|float|double|decimal|bigint|smallint|tinyint|numeric)/i.test(type.trim());
}

export function statusTone(status: string | undefined): "success" | "danger" | "warning" | "info" | "neutral" {
  switch ((status ?? "").toUpperCase()) {
    case "FINISHED":
    case "SUCCESS":
    case "SUCCEEDED":
    case "COMPLETED":
    case "OK":
    case "ALIVE":
    case "COMPLETE":
      return "success";
    case "FAILED":
    case "ERROR":
    case "TRIGGERED":
    case "TIMED_OUT":
    case "UPSTREAM_FAILED":
    case "DEAD":
      return "danger";
    case "RUNNING":
    case "PENDING":
    case "WAITING":
    case "INITIALIZING":
      return "info";
    case "CANCELED":
    case "CANCELLED":
    case "SKIPPED":
    case "QUEUED":
      return "warning";
    default:
      return "neutral";
  }
}

/** Accent colour for a run/task/dataset status — used for DAG node bars. */
export function statusColor(status: string | undefined | null): string {
  switch (statusTone(status ?? undefined)) {
    case "success":
      return "var(--text-success)";
    case "danger":
      return "var(--text-danger)";
    case "info":
      return "var(--action-primary-bg)";
    case "warning":
      return "var(--text-warning)";
    default:
      return "var(--border-strong)";
  }
}

/** Human label for an ALL_CAPS_SNAKE status. */
export function statusLabel(status: string | undefined | null): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** Turn "unity.demo.orders" into its parts. */
export function splitFullName(fullName: string): { catalog: string; schema: string; table: string } {
  const [catalog = "", schema = "", table = ""] = fullName.split(".");
  return { catalog, schema, table };
}
