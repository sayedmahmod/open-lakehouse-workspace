/** Accent theming: derive a whole token family from one colour.
 *
 * The palette in globals.css is semantic, so re-skinning the workspace means
 * overriding ~16 tokens rather than one. Deriving them in OKLCH keeps the
 * relationships perceptual — hover is always the same *visual* step darker,
 * whatever hue you pick — and lets us pick a legible on-accent ink per colour
 * instead of assuming white.
 *
 * Light and dark need different derivations (a colour readable on white is
 * rarely readable on near-black), so we emit both and let the theme selectors
 * choose, exactly the way globals.css does.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1 */
  L: number;
  /** Chroma, 0..~0.37 */
  C: number;
  /** Hue angle in degrees */
  h: number;
}

/* ------------------------------------------------------------ sRGB ↔ OKLab */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb(L: number, a: number, bb: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number];
  const [L, a, bb] = linearRgbToOklab(r, g, b);
  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** OKLCH → hex, walking chroma down until the colour fits inside sRGB. */
export function oklchToHex({ L, C, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  let lo = 0;
  let hi = C;
  let best: [number, number, number] = [0, 0, 0];
  // 20 bisection steps lands well inside a 1/255 quantisation step.
  for (let i = 0; i < 20; i++) {
    const c = (lo + hi) / 2;
    const rgb = oklabToLinearRgb(L, Math.cos(rad) * c, Math.sin(rad) * c);
    if (rgb.every((v) => v >= -0.0001 && v <= 1.0001)) {
      best = rgb;
      lo = c;
    } else {
      hi = c;
    }
  }
  if (lo === 0) best = oklabToLinearRgb(L, 0, 0);
  const [r, g, b] = best.map(linearToSrgb) as [number, number, number];
  return rgbToHex(r, g, b);
}

/* ---------------------------------------------------------------- contrast */

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever of white / near-black reads better on `bg`. */
function inkOn(bg: string, dark: string): string {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, dark) ? "#FFFFFF" : dark;
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((c) => Math.round(c * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* -------------------------------------------------------------- derivation */

const DARK_INK = "#0E1A18";

/** Tokens whose value follows the accent. Everything else stays in globals.css. */
export type TokenMap = Record<string, string>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function deriveLight(accent: Oklch): TokenMap {
  const C = Math.min(accent.C, 0.17);
  const h = accent.h;
  const at = (L: number, c = C) => oklchToHex({ L, C: c, h });

  // A fill keeps the lightness you picked (only clamped into a usable band) and
  // flips its label to dark ink when the colour is light — pick a bright yellow
  // and you get bright yellow buttons, not a muddy olive.
  const fillL = clamp(accent.L, 0.45, 0.72);
  const primary = at(fillL);
  const hover = at(Math.max(0.36, fillL - 0.07));
  const press = at(Math.max(0.3, fillL - 0.14));
  // Text and links sit on the page background instead, so they have to stay
  // dark enough to read on white however light the accent is.
  const textL = Math.min(fillL, 0.55);
  const text = at(textL);
  const textHover = at(Math.max(0.34, textL - 0.07));
  return {
    "--action-primary-bg": primary,
    "--action-primary-bg-hover": hover,
    "--action-primary-bg-press": press,
    "--action-primary-text": inkOn(primary, DARK_INK),
    "--action-default-border-hover": text,
    "--action-default-text-hover": textHover,
    "--action-default-bg-hover": rgba(text, 0.08),
    "--action-default-bg-press": rgba(text, 0.16),
    "--action-icon-hover": textHover,
    "--link": text,
    "--link-hover": textHover,
    "--focus-ring": text,
    "--progress-fill": primary,
    "--bg-info": at(0.975, Math.min(C, 0.035)),
    "--dag-edge": at(0.84, Math.min(C, 0.075)),
    "--dag-edge-strong": text,
    "--series-1": text,
  };
}

function deriveDark(accent: Oklch): TokenMap {
  const C = Math.min(accent.C, 0.15);
  const h = accent.h;
  const at = (L: number, c = C) => oklchToHex({ L, C: c, h });

  const fillL = clamp(accent.L, 0.62, 0.88);
  const primary = at(fillL, Math.min(C, 0.14));
  const hover = at(Math.min(0.95, fillL + 0.07), Math.min(C, 0.11));
  const press = at(Math.min(0.97, fillL + 0.13), Math.min(C, 0.08));
  // On a near-black ground, text has to stay bright rather than dark.
  const textL = Math.max(fillL, 0.72);
  const text = at(textL, Math.min(C, 0.14));
  const textHover = at(Math.min(0.95, textL + 0.07), Math.min(C, 0.11));
  return {
    "--action-primary-bg": primary,
    "--action-primary-bg-hover": hover,
    "--action-primary-bg-press": press,
    "--action-primary-text": inkOn(primary, DARK_INK),
    "--action-default-border-hover": textHover,
    "--action-default-text-hover": textHover,
    "--action-default-bg-hover": rgba(text, 0.08),
    "--action-default-bg-press": rgba(text, 0.16),
    "--action-icon-hover": textHover,
    "--link": text,
    "--link-hover": textHover,
    "--focus-ring": textHover,
    "--progress-fill": primary,
    "--bg-info": rgba(text, 0.16),
    "--dag-edge": at(0.45, Math.min(C, 0.1)),
    "--dag-edge-strong": text,
    "--series-1": text,
  };
}

/** The brand tile carries white text, so keep the colour dark enough for it. */
function deriveBrand(brand: Oklch): string {
  return oklchToHex({ L: Math.min(brand.L, 0.72), C: Math.min(brand.C, 0.19), h: brand.h });
}

/** The derived tokens for one theme — same values the stylesheet gets, so
 *  callers can inspect a colour choice without reading back from the DOM. */
export function accentTokens(accentHex: string, mode: "light" | "dark"): TokenMap | null {
  const accent = hexToOklch(accentHex);
  if (!accent) return null;
  return mode === "light" ? deriveLight(accent) : deriveDark(accent);
}

/** Contrast of button label against button fill, for both themes. */
export function accentContrast(accentHex: string): { light: number; dark: number } | null {
  const light = accentTokens(accentHex, "light");
  const dark = accentTokens(accentHex, "dark");
  if (!light || !dark) return null;
  return {
    light: contrastRatio(light["--action-primary-bg"], light["--action-primary-text"]),
    dark: contrastRatio(dark["--action-primary-bg"], dark["--action-primary-text"]),
  };
}

/** CSS overriding the accent tokens, mirroring the theme selectors in globals.css. */
export function accentCss(accentHex: string, brandHex: string): string {
  const accent = hexToOklch(accentHex);
  const brand = hexToOklch(brandHex);
  if (!accent || !brand) return "";

  const light = deriveLight(accent);
  const dark = deriveDark(accent);
  const brandValue = deriveBrand(brand);

  const body = (map: TokenMap, indent: string) =>
    Object.entries(map)
      .map(([k, v]) => `${indent}${k}: ${v};`)
      .join("\n");

  return [
    `:root {`,
    body(light, "  "),
    `  --brand: ${brandValue};`,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root:not([data-theme="light"]) {`,
    body(dark, "    "),
    `  }`,
    `}`,
    `:root[data-theme="dark"] {`,
    body(dark, "  "),
    `}`,
  ].join("\n");
}

/* ----------------------------------------------------------------- presets */

export interface AccentPreset {
  id: string;
  name: string;
  accent: string;
  brand: string;
}

export const DEFAULT_ACCENT = "#0D9488";
export const DEFAULT_BRAND = "#059669";

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "teal", name: "Teal", accent: DEFAULT_ACCENT, brand: DEFAULT_BRAND },
  { id: "indigo", name: "Indigo", accent: "#4F46E5", brand: "#6366F1" },
  { id: "violet", name: "Violet", accent: "#7C3AED", brand: "#9333EA" },
  { id: "sky", name: "Sky", accent: "#0284C7", brand: "#0EA5E9" },
  { id: "emerald", name: "Emerald", accent: "#059669", brand: "#10B981" },
  { id: "amber", name: "Amber", accent: "#B45309", brand: "#D97706" },
  { id: "rose", name: "Rose", accent: "#E11D48", brand: "#F43F5E" },
  { id: "slate", name: "Slate", accent: "#475569", brand: "#64748B" },
];

export const isHex = (value: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());

export const normalizeHex = (value: string) => {
  const rgb = hexToRgb(value);
  return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : null;
};
