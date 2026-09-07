"use client";

/** Interface primitives, styled to the design tokens in globals.css. */
import clsx from "clsx";
import { AlertCircle, Check, ChevronDown, Info, Loader2, Search, X } from "lucide-react";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* -------------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "default" | "tertiary" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const height = size === "sm" ? "h-6" : size === "lg" ? "h-9" : "h-8";
  const padding = children ? (size === "sm" ? "px-2" : "px-3") : size === "sm" ? "px-1" : "px-2";

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-[4px] font-medium whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed",
        height,
        padding,
        className,
      )}
      style={{
        fontSize: size === "sm" ? 12 : 13,
        ...(disabled || loading
          ? {
              background: variant === "tertiary" ? "transparent" : "var(--action-disabled-bg)",
              color: "var(--action-disabled-text)",
              border: variant === "tertiary" ? "1px solid transparent" : "1px solid var(--action-disabled-border)",
            }
          : variant === "primary"
            ? { background: "var(--action-primary-bg)", color: "var(--action-primary-text)", border: "1px solid transparent" }
            : variant === "danger"
              ? { background: "var(--action-danger-bg)", color: "#fff", border: "1px solid transparent" }
              : variant === "tertiary"
                ? { background: "transparent", color: "var(--link)", border: "1px solid transparent" }
                : { background: "var(--bg-primary)", color: "var(--action-default-text)", border: "1px solid var(--action-default-border)" }),
      }}
      onMouseEnter={(e) => {
        if (disabled || loading) return;
        const el = e.currentTarget;
        if (variant === "primary") el.style.background = "var(--action-primary-bg-hover)";
        else if (variant === "danger") el.style.background = "var(--action-danger-bg-hover)";
        else if (variant === "tertiary") el.style.background = "var(--action-default-bg-hover)";
        else {
          el.style.borderColor = "var(--action-default-border-hover)";
          el.style.color = "var(--action-default-text-hover)";
        }
      }}
      onMouseLeave={(e) => {
        if (disabled || loading) return;
        const el = e.currentTarget;
        if (variant === "primary") el.style.background = "var(--action-primary-bg)";
        else if (variant === "danger") el.style.background = "var(--action-danger-bg)";
        else if (variant === "tertiary") el.style.background = "transparent";
        else {
          el.style.borderColor = "var(--action-default-border)";
          el.style.color = "var(--action-default-text)";
        }
      }}
    >
      {loading ? <Loader2 size={size === "sm" ? 12 : 14} className="lh-spin" /> : icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ IconButton */

export function IconButton({
  className,
  title,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      style={{
        color: active ? "var(--link)" : "var(--action-icon-default)",
        background: active ? "var(--action-default-bg-hover)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (e.currentTarget.disabled) return;
        e.currentTarget.style.background = "var(--action-default-bg-hover)";
        e.currentTarget.style.color = "var(--action-icon-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--action-default-bg-hover)" : "transparent";
        e.currentTarget.style.color = active ? "var(--link)" : "var(--action-icon-default)";
      }}
    />
  );
}

/* --------------------------------------------------------------------- Input */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        {...rest}
        ref={ref}
        className={clsx("h-8 w-full rounded-[4px] px-2 outline-none transition-colors", className)}
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--action-default-border)",
          fontSize: 13,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--focus-ring)";
          e.currentTarget.style.boxShadow = "0 0 0 1px var(--focus-ring)";
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--action-default-border)";
          e.currentTarget.style.boxShadow = "none";
          rest.onBlur?.(e);
        }}
      />
    );
  },
);

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={clsx("w-full rounded-[4px] p-2 outline-none transition-colors", className)}
      style={{
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        border: "1px solid var(--action-default-border)",
        fontSize: 13,
        lineHeight: "20px",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--focus-ring)";
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--action-default-border)";
        rest.onBlur?.(e);
      }}
    />
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <Search
        size={14}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
        style={{ color: "var(--text-secondary)" }}
      />
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="!pl-7"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5"
          style={{ color: "var(--text-secondary)" }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Select */

export function Select({
  value,
  onChange,
  options,
  className,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none rounded-[4px] pl-2 pr-7 outline-none disabled:opacity-50"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--action-default-border)",
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: "var(--text-secondary)" }}
      />
    </div>
  );
}

/* --------------------------------------------------------------------- Badge */

export type Tone = "success" | "danger" | "warning" | "info" | "neutral";

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  success: { bg: "var(--bg-success)", fg: "var(--text-success)", border: "var(--text-success)" },
  danger: { bg: "var(--bg-danger)", fg: "var(--text-danger)", border: "var(--border-danger)" },
  warning: { bg: "var(--bg-warning)", fg: "var(--text-warning)", border: "var(--border-warning)" },
  info: { bg: "var(--bg-info)", fg: "var(--link)", border: "var(--link)" },
  neutral: { bg: "var(--bg-secondary)", fg: "var(--text-secondary)", border: "var(--border-strong)" },
};

export function Badge({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-medium", className)}
      style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}`, fontSize: 11, lineHeight: "16px" }}
    >
      {icon}
      {children}
    </span>
  );
}

/** Status pill that pairs a colour with a shape, so state never rests on hue alone. */
export function StatusBadge({ status }: { status: string }) {
  const tone = ((): Tone => {
    switch (status.toUpperCase()) {
      case "FINISHED":
      case "SUCCESS":
      case "COMPLETED":
      case "OK":
      case "ALIVE":
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
  })();
  const label = status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

  const icon =
    tone === "success" ? (
      <Check size={11} />
    ) : tone === "danger" ? (
      <AlertCircle size={11} />
    ) : tone === "info" ? (
      <Loader2 size={11} className={status.toUpperCase() === "RUNNING" ? "lh-spin" : ""} />
    ) : (
      <Info size={11} />
    );

  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

/* ---------------------------------------------------------------------- Tabs */

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={clsx("flex items-center gap-1 overflow-x-auto", className)}
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="relative whitespace-nowrap px-3 py-2 font-medium transition-colors"
            style={{
              fontSize: 13,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: isActive ? "inset 0 -2px 0 var(--action-primary-bg)" : "none",
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{ color: "var(--text-secondary)", marginLeft: 6, fontWeight: 400 }}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- SegmentedControl */

/** The Graph / Timeline / List switcher on a job run — a joined button group. */
export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: { value: string; label: React.ReactNode; title?: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="group" className={clsx("inline-flex", className)}>
      {options.map((opt, i) => {
        const isActive = opt.value === value;
        const first = i === 0;
        const last = i === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 px-2.5" : "h-8 px-3",
            )}
            style={{
              fontSize: size === "sm" ? 12 : 13,
              background: isActive ? "var(--action-default-bg-hover)" : "var(--bg-primary)",
              color: isActive ? "var(--link)" : "var(--action-default-text)",
              border: `1px solid ${isActive ? "var(--action-primary-bg)" : "var(--action-default-border)"}`,
              // Collapse the shared border between neighbouring segments.
              marginLeft: first ? 0 : -1,
              zIndex: isActive ? 1 : 0,
              borderTopLeftRadius: first ? 4 : 0,
              borderBottomLeftRadius: first ? 4 : 0,
              borderTopRightRadius: last ? 4 : 0,
              borderBottomRightRadius: last ? 4 : 0,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="my-auto w-full rounded-[8px]"
        style={{ maxWidth: width, background: "var(--bg-primary)", boxShadow: "var(--shadow-lg)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="font-semibold" style={{ fontSize: 16 }}>
            {title}
          </h2>
          <IconButton onClick={onClose} title="Close">
            <X size={15} />
          </IconButton>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-4 py-3"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block font-medium" style={{ fontSize: 13, color: "var(--text-primary)" }}>
        {label}
        {required && <span style={{ color: "var(--text-danger)" }}> *</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/* ----------------------------------------------------------------- Feedback */

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx("lh-spin", className)} style={{ color: "var(--text-secondary)" }} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div style={{ color: "var(--text-secondary)", marginBottom: 12 }}>{icon}</div>}
      <div className="font-semibold" style={{ fontSize: 14 }}>
        {title}
      </div>
      {description && (
        <div className="mt-1 max-w-md" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[4px] p-3"
      style={{ background: "var(--bg-danger)", border: "1px solid var(--border-danger)" }}
    >
      <AlertCircle size={15} style={{ color: "var(--text-danger)", flexShrink: 0, marginTop: 1 }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium" style={{ fontSize: 13, color: "var(--text-danger)" }}>
          Something went wrong
        </div>
        <div className="mono mt-1 break-words" style={{ fontSize: 12, color: "var(--text-primary)" }}>
          {message}
        </div>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={clsx("lh-skeleton", className)} style={style} />;
}

/* --------------------------------------------------------------------- Toast */

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => {
          const t = TONES[toast.tone];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex max-w-md items-start gap-2 rounded-[4px] px-3 py-2"
              style={{ background: "var(--bg-primary)", border: `1px solid ${t.border}`, boxShadow: "var(--shadow-md)" }}
            >
              <span style={{ color: t.fg, marginTop: 1 }}>
                {toast.tone === "danger" ? <AlertCircle size={14} /> : toast.tone === "success" ? <Check size={14} /> : <Info size={14} />}
              </span>
              <span style={{ fontSize: 13 }}>{toast.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t2) => t2.id !== toast.id))}
                aria-label="Dismiss"
                style={{ color: "var(--text-secondary)" }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ Dropdown */

export function Dropdown({
  trigger,
  items,
  align = "right",
}: {
  trigger: React.ReactNode;
  items: { label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode; disabled?: boolean }[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={clsx("absolute z-40 mt-1 min-w-44 rounded-[4px] py-1", align === "right" ? "right-0" : "left-0")}
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-md)" }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40"
              style={{ fontSize: 13, color: item.danger ? "var(--text-danger)" : "var(--text-primary)" }}
              onMouseEnter={(e) => {
                if (!item.disabled) e.currentTarget.style.background = "var(--table-row-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- Table */

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
  emptyMessage = "No rows",
  dense,
}: {
  columns: { key: string; header: React.ReactNode; width?: number | string; render: (row: T) => React.ReactNode; align?: "left" | "right" }[];
  rows: T[];
  keyOf: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  dense?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--table-header-bg)" }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx("px-3 font-medium", dense ? "py-1.5" : "py-2", col.align === "right" ? "text-right" : "text-left")}
                style={{
                  width: col.width,
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border)",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={keyOf(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx(onRowClick && "cursor-pointer")}
              style={{ borderBottom: "1px solid var(--border)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--table-row-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={clsx("px-3", dense ? "py-1.5" : "py-2", col.align === "right" && "text-right")}
                  style={{ color: "var(--text-primary)" }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ Resizer */

/** Drag handle for the split panes in the SQL editor and catalog explorer. */
export function useResizable(initial: number, min: number, max: number, axis: "x" | "y" = "x") {
  const [size, setSize] = useState(initial);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const start = axis === "x" ? e.clientX : e.clientY;
    const startSize = size;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (axis === "x" ? ev.clientX : ev.clientY) - start;
      setSize(Math.min(max, Math.max(min, startSize + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [size, min, max, axis]);

  const handle = useMemo(
    () => (
      <div
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation={axis === "x" ? "vertical" : "horizontal"}
        className={clsx("shrink-0 transition-colors", axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize")}
        style={{ background: "var(--border)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--action-primary-bg)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--border)";
        }}
      />
    ),
    [onMouseDown, axis],
  );

  return { size, setSize, handle };
}
