import type { Schedule } from "./types";

const CRON_LABELS: Record<string, string> = {
  "0 * * * *": "Every hour",
  "*/15 * * * *": "Every 15 minutes",
  "*/30 * * * *": "Every 30 minutes",
  "0 0 * * *": "Daily at midnight",
  "0 9 * * *": "Daily at 09:00",
  "0 9 * * 1-5": "Weekdays at 09:00",
  "0 0 * * 0": "Weekly on Sunday",
  "0 0 1 * *": "Monthly on the 1st",
};

export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 03:00", value: "0 3 * * *" },
  { label: "Every day at 09:00", value: "0 9 * * *" },
  { label: "Weekdays at 09:00", value: "0 9 * * 1-5" },
  { label: "Weekly (Sunday 00:00)", value: "0 0 * * 0" },
  { label: "Monthly (1st, 00:00)", value: "0 0 1 * *" },
];

/** Human-readable label for a job or alert schedule. */
export function scheduleLabel(schedule: Schedule | null | undefined): string {
  if (!schedule) return "Manual only";
  if (schedule.kind === "interval") {
    const every = schedule.every ?? 15;
    const unit = schedule.unit ?? "minutes";
    return `Every ${every} ${every === 1 ? unit.replace(/s$/, "") : unit}`;
  }
  if (schedule.kind === "daily") return `Daily at ${schedule.at ?? "03:00"} UTC`;
  if (schedule.kind === "cron") {
    const expr = (schedule.cron ?? "0 * * * *").trim();
    const base = CRON_LABELS[expr] ?? `cron: ${expr}`;
    return schedule.tz && schedule.tz !== "UTC" ? `${base} (${schedule.tz})` : base;
  }
  return "Manual only";
}
