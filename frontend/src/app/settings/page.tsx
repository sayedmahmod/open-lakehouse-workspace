"use client";

import { Check, Monitor, Moon, RotateCcw, Sparkles, Sun } from "lucide-react";
import React, { useState } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Badge, Button, ErrorBanner, Input, Select, Skeleton, StatusBadge, useToast } from "@/components/ui";
import { ACCENT_PRESETS, accentContrast, isHex, normalizeHex } from "@/lib/accent";
import { api } from "@/lib/api";
import { formatNumber, formatRelative } from "@/lib/format";
import type { AiStatus, ReasoningEffort } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";

export default function SettingsPage() {
  const config = useAsync(() => api.config(), []);
  const health = useAsync(() => api.compute.health(), []);
  const { theme, setTheme } = useTheme();

  return (
    <div className="pb-10">
      <PageHeader title="Settings" description="Workspace preferences and the endpoints this UI talks to" />

      <div className="max-w-3xl px-6">
        <section className="lh-card mb-4 p-4">
          <h2 className="mb-1 font-semibold" style={{ fontSize: 14 }}>
            Appearance
          </h2>
          <p className="mb-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Choose a theme, or follow the operating system.
          </p>
          <div className="flex gap-2">
            {[
              { id: "light" as const, label: "Prefer light", icon: <Sun size={14} /> },
              { id: "dark" as const, label: "Prefer dark", icon: <Moon size={14} /> },
              { id: "system" as const, label: "Use system settings", icon: <Monitor size={14} /> },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() => setTheme(option.id)}
                className="inline-flex items-center gap-2 rounded-[4px] px-3 py-2"
                style={{
                  fontSize: 13,
                  border: `1px solid ${theme === option.id ? "var(--action-primary-bg)" : "var(--action-default-border)"}`,
                  background: theme === option.id ? "var(--bg-info)" : "var(--bg-primary)",
                  color: theme === option.id ? "var(--link)" : "var(--text-primary)",
                }}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <ColorSection />

        <AiSection />

        <section className="lh-card mb-4 p-4">
          <h2 className="mb-3 font-semibold" style={{ fontSize: 14 }}>
            Services
          </h2>
          {health.loading && <Skeleton style={{ height: 100 }} />}
          {health.error && <ErrorBanner message={health.error} onRetry={health.reload} />}
          <div className="flex flex-col gap-2">
            {health.data?.services.map((service) => (
              <div key={service.name} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div style={{ fontSize: 13 }}>{service.name}</div>
                  <div className="mono truncate" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {service.endpoint}
                  </div>
                </div>
                <Badge tone={service.healthy ? "success" : "danger"}>{service.healthy ? "Healthy" : "Down"}</Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="lh-card p-4">
          <h2 className="mb-1 font-semibold" style={{ fontSize: 14 }}>
            Connection
          </h2>
          <p className="mb-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Set through environment variables on the workspace API. No authentication is configured — this workspace is
            intended for a local stack.
          </p>
          {config.data && (
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Object.entries(config.data).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt style={{ fontSize: 12, color: "var(--text-secondary)" }}>{key.replace(/_/g, " ")}</dt>
                  <dd className="mono truncate" style={{ fontSize: 12 }} title={String(value)}>
                    {String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- AI */

/** Pick the local coding-agent CLI used for cell edits, and see how much has
 *  been spent. Counts are this workspace's own tally, summed from each CLI run
 *  — the CLIs expose no quota API. */
const CUSTOM = "__custom__";

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
};

function AiSection() {
  const status = useAsync<AiStatus>(() => api.ai.status(), []);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const data = status.data;
  const activeProvider = data?.providers.find((p) => p.id === data.active.provider);
  const models = activeProvider?.models ?? [];
  const storedModel = data?.active.model ?? "";
  const storedEffort = data?.active.reasoning_effort ?? "";
  const selectedModel = models.find((model) => model.id === storedModel);
  const isCustom = customOpen || (!!storedModel && !selectedModel);
  const reasoningEfforts = selectedModel?.reasoning_efforts ?? activeProvider?.reasoning_efforts ?? [];

  const choose = async (provider: string, nextModel: string, reasoningEffort: string) => {
    setBusy(true);
    try {
      await api.ai.saveSettings({ provider, model: nextModel, reasoning_effort: reasoningEffort });
      status.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save", "danger");
    } finally {
      setBusy(false);
    }
  };

  const install = async (provider: string) => {
    setInstalling(provider);
    try {
      const res = await api.ai.install(provider);
      status.reload();
      toast(
        res.ok ? `${provider} installed` : "Install failed — see console for CLI output",
        res.ok ? "success" : "danger",
      );
      if (!res.ok) console.error(res.output);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Install failed", "danger");
    } finally {
      setInstalling(null);
    }
  };

  const resetUsage = async () => {
    try {
      await api.ai.resetUsage();
      status.reload();
      toast("Usage counters reset", "success");
    } catch {
      toast("Could not reset", "danger");
    }
  };

  const usage = data?.usage;

  return (
    <section className="lh-card mb-4 p-4">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={14} style={{ color: "var(--link)" }} />
        <h2 className="font-semibold" style={{ fontSize: 14 }}>
          AI assistant
        </h2>
      </div>
      <p className="mb-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        The sparkle in the SQL editor and notebook cells rewrites content through a local
        coding-agent CLI. Pick which one to use, and the model it should run.
      </p>

      {status.loading && <Skeleton style={{ height: 90 }} />}
      {status.error && <ErrorBanner message={status.error} onRetry={status.reload} />}

      {data && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {data.providers.map((p) => {
              const active = data.active.provider === p.id;
              if (!p.available) {
                return (
                  <div
                    key={p.id}
                    className="inline-flex flex-col items-start gap-1.5 rounded-[4px] px-3 py-2"
                    style={{
                      fontSize: 13,
                      border: "1px solid var(--action-default-border)",
                      background: "var(--bg-primary)",
                    }}
                  >
                    <span>{p.name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>not detected</span>
                    <Button
                      size="sm"
                      loading={installing === p.id}
                      disabled={!!installing}
                      onClick={() => install(p.id)}
                    >
                      Install
                    </Button>
                  </div>
                );
              }
              return (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() => {
                    setCustomOpen(false);
                    setCustomText("");
                    choose(p.id, active ? storedModel : "", active ? storedEffort : "");
                  }}
                  className="inline-flex flex-col items-start gap-0.5 rounded-[4px] px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    fontSize: 13,
                    border: `1px solid ${active ? "var(--action-primary-bg)" : "var(--action-default-border)"}`,
                    background: active ? "var(--bg-info)" : "var(--bg-primary)",
                    color: active ? "var(--link)" : "var(--text-primary)",
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {active && <Check size={13} />}
                    {p.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {p.version ?? "installed"}
                  </span>
                </button>
              );
            })}
          </div>

          {activeProvider?.available && (
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div>
                <div className="mb-1" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Model
                </div>
                <Select
                  ariaLabel="AI model"
                  className="w-56"
                  value={isCustom ? CUSTOM : storedModel}
                  onChange={(v) => {
                    if (v === CUSTOM) {
                      setCustomText(storedModel);
                      setCustomOpen(true);
                    } else {
                      setCustomOpen(false);
                      const nextModel = models.find((model) => model.id === v);
                      const nextEffort =
                        storedEffort && nextModel && !nextModel.reasoning_efforts.includes(storedEffort)
                          ? ""
                          : storedEffort;
                      choose(data.active.provider, v, nextEffort);
                    }
                  }}
                  options={[
                    { value: "", label: "Provider default" },
                    ...models.map((model) => ({
                      value: model.id,
                      label: `${model.name} — ${model.id}`,
                    })),
                    { value: CUSTOM, label: "Custom…" },
                  ]}
                />
              </div>
              {isCustom && (
                <>
                  <Input
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="model id"
                    className="mono w-56"
                    spellCheck={false}
                  />
                  <Button
                    size="sm"
                    disabled={busy || !customText.trim()}
                    onClick={() => choose(data.active.provider, customText.trim(), storedEffort)}
                  >
                    Save
                  </Button>
                </>
              )}
              <div>
                <div className="mb-1" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Reasoning effort
                </div>
                <Select
                  ariaLabel="Reasoning effort"
                  className="w-44"
                  value={storedEffort}
                  disabled={busy || reasoningEfforts.length === 0}
                  onChange={(reasoningEffort) =>
                    choose(data.active.provider, storedModel, reasoningEffort)
                  }
                  options={
                    reasoningEfforts.length === 0
                      ? [{ value: "", label: "Not supported" }]
                      : [
                          {
                            value: "",
                            label: selectedModel?.default_reasoning_effort
                              ? `CLI default · model default: ${EFFORT_LABELS[selectedModel.default_reasoning_effort]}`
                              : "CLI default",
                          },
                          ...reasoningEfforts.map((effort) => ({
                            value: effort,
                            label: EFFORT_LABELS[effort],
                          })),
                        ]
                  }
                />
              </div>
            </div>
          )}

          <div className="rounded-[4px] p-3" style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
            <div className="mb-2 flex items-center gap-2">
              <span style={{ fontSize: 12, fontWeight: 600 }}>Usage</span>
              {usage?.since && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  since {formatRelative(usage.since)}
                </span>
              )}
              <span className="ml-auto">
                <Button size="sm" icon={<RotateCcw size={12} />} onClick={resetUsage} disabled={!usage?.requests}>
                  Reset
                </Button>
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1" style={{ fontSize: 12 }}>
              <Stat label="Requests" value={formatNumber(usage?.requests ?? 0)} />
              <Stat label="Input tokens" value={formatNumber(usage?.input_tokens ?? 0)} />
              <Stat label="Output tokens" value={formatNumber(usage?.output_tokens ?? 0)} />
              <Stat
                label="Est. cost"
                value={usage?.cost_usd != null ? `$${usage.cost_usd.toFixed(4)}` : "—"}
              />
            </div>

            {!!usage?.recent.length && (
              <div className="mt-2" style={{ borderTop: "1px solid var(--border)" }}>
                {usage.recent.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 py-1"
                    style={{ fontSize: 11.5, color: "var(--text-secondary)" }}
                  >
                    <span style={{ width: 90 }}>{formatRelative(r.created_at)}</span>
                    <span style={{ width: 90 }}>{r.surface || "—"}</span>
                    <span style={{ width: 54 }}>{r.provider}</span>
                    <span>
                      {formatNumber(r.input_tokens)} in · {formatNumber(r.output_tokens)} out
                    </span>
                    {!r.ok && <Badge tone="danger">failed</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: "var(--text-secondary)" }}>{label}: </span>
      <span className="mono">{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ colours */

/** Accent and brand pickers. Every other colour in the workspace is derived
 *  from these two, so the presets and the picker drive the same code path. */
function ColorSection() {
  const { accent, brand, setColors, resetColors, isCustomized } = useTheme();

  return (
    <section className="lh-card mb-4 p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold" style={{ fontSize: 14 }}>
          Colours
        </h2>
        {isCustomized && <Badge>Customised</Badge>}
        <span className="ml-auto">
          <Button size="sm" icon={<RotateCcw size={12} />} onClick={resetColors} disabled={!isCustomized}>
            Reset
          </Button>
        </span>
      </div>
      <p className="mb-3" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        The accent drives buttons, links, focus rings, charts and the task graph. Hover, pressed and dark-theme
        variants are derived from it, so both themes stay consistent. Saved in this browser.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const active = accent.toUpperCase() === preset.accent.toUpperCase();
          return (
            <button
              key={preset.id}
              onClick={() => setColors({ accent: preset.accent, brand: preset.brand })}
              title={`${preset.name} — ${preset.accent}`}
              className="inline-flex items-center gap-2 rounded-[4px] py-1.5 pl-1.5 pr-2.5"
              style={{
                fontSize: 12.5,
                border: `1px solid ${active ? "var(--action-primary-bg)" : "var(--action-default-border)"}`,
                background: active ? "var(--bg-info)" : "var(--bg-primary)",
              }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-[3px]"
                style={{ background: preset.accent, color: "#fff" }}
              >
                {active && <Check size={12} />}
              </span>
              {preset.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-6">
        <ColorField label="Accent" value={accent} onChange={(v) => setColors({ accent: v })} />
        <ColorField label="Brand mark" value={brand} onChange={(v) => setColors({ brand: v })} />
      </div>

      <ColorPreview accent={accent} />
    </section>
  );
}

/** A swatch, a native colour picker and a hex field kept in sync. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  // Uncontrolled and keyed on `value`: a preset click or Reset remounts the
  // field with the new hex, so there is no prop-to-state sync to keep straight.
  const commit = (input: HTMLInputElement) => {
    const hex = isHex(input.value) ? normalizeHex(input.value) : null;
    if (hex) onChange(hex);
    else input.value = value;
  };

  return (
    <div>
      <div className="mb-1" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {label}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 cursor-pointer rounded-[4px] bg-transparent p-0"
          style={{ border: "1px solid var(--action-default-border)" }}
        />
        <Input
          key={value}
          defaultValue={value}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget)}
          aria-label={`${label} hex value`}
          className="mono w-28"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/** Live sample of the components the accent touches, plus the contrast the
 *  chosen colour achieves for button text in each theme. */
function ColorPreview({ accent }: { accent: string }) {
  const ratio = accentContrast(accent);
  const verdict = (r: number) => (r >= 4.5 ? "AA" : r >= 3 ? "large only" : "below AA");

  return (
    <div className="mt-4 rounded-[4px] p-3" style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
      <div className="mb-2" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Preview
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm">Run now</Button>
        <Button size="sm">Save</Button>
        <a href="#colours" onClick={(e) => e.preventDefault()} style={{ fontSize: 13, color: "var(--link)" }}>
          A link
        </a>
        <StatusBadge status="SUCCESS" />
        <StatusBadge status="RUNNING" />
        <StatusBadge status="FAILED" />
        <span className="h-1.5 w-24 overflow-hidden rounded-full" style={{ background: "var(--progress-track)" }}>
          <span className="block h-full w-2/3" style={{ background: "var(--progress-fill)" }} />
        </span>
        {ratio && (
          <span className="ml-auto" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
            Button text contrast — light {ratio.light.toFixed(1)}:1 ({verdict(ratio.light)}) · dark{" "}
            {ratio.dark.toFixed(1)}:1 ({verdict(ratio.dark)})
          </span>
        )}
      </div>
    </div>
  );
}
