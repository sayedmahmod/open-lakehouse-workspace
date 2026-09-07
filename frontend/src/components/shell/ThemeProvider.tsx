"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { DEFAULT_ACCENT, DEFAULT_BRAND, accentCss, normalizeHex } from "@/lib/accent";

type Theme = "light" | "dark" | "system";

export const THEME_KEY = "ol-theme";
export const ACCENT_KEY = "ol-accent";
export const BRAND_KEY = "ol-brand";
/** The generated CSS, cached so the pre-paint script can inject it without
 *  re-running the colour maths before React boots. */
export const ACCENT_CSS_KEY = "ol-accent-css";
/** Id of the <style> element holding the derived accent tokens. */
export const ACCENT_STYLE_ID = "ol-accent-style";

interface ThemeValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Accent hex driving links, buttons, focus rings and graph edges. */
  accent: string;
  /** Brand hex, used for the sidebar mark. */
  brand: string;
  setColors: (next: { accent?: string; brand?: string }) => void;
  resetColors: () => void;
  isCustomized: boolean;
}

const ThemeContext = createContext<ThemeValue>({
  theme: "system",
  setTheme: () => {},
  accent: DEFAULT_ACCENT,
  brand: DEFAULT_BRAND,
  setColors: () => {},
  resetColors: () => {},
  isCustomized: false,
});

export const useTheme = () => useContext(ThemeContext);

/** Writes the derived accent tokens into a <style> tag. A stylesheet rather
 *  than inline styles on <html>, because light and dark need different values
 *  and only a rule can be scoped to the theme selector. */
function applyAccent(accent: string, brand: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(ACCENT_STYLE_ID) as HTMLStyleElement | null;
  const isDefault = accent === DEFAULT_ACCENT && brand === DEFAULT_BRAND;
  if (isDefault) {
    el?.remove();
    try {
      localStorage.removeItem(ACCENT_CSS_KEY);
    } catch {
      /* non-fatal */
    }
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = ACCENT_STYLE_ID;
    // Last in <head> so it outranks globals.css at equal specificity.
    document.head.appendChild(el);
  }
  const css = accentCss(accent, brand);
  el.textContent = css;
  try {
    localStorage.setItem(ACCENT_CSS_KEY, css);
  } catch {
    /* non-fatal */
  }
}

function applyTheme(next: Theme) {
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
}

/** Stamps data-theme on <html>; "system" removes the stamp so the CSS media
 *  query decides — a light / dark / system preference. Also owns the accent
 *  colours, which are derived into CSS variables at runtime. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [brand, setBrand] = useState(DEFAULT_BRAND);

  // Preferences live in localStorage, which the server render cannot see, so
  // they are read once on mount. The cascade the rule warns about is bounded:
  // this runs a single time and the pre-paint script has already applied the
  // colours, so nothing flashes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const storedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
      if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
        setThemeState(storedTheme);
        applyTheme(storedTheme);
      }
      const a = normalizeHex(localStorage.getItem(ACCENT_KEY) ?? "") ?? DEFAULT_ACCENT;
      const b = normalizeHex(localStorage.getItem(BRAND_KEY) ?? "") ?? DEFAULT_BRAND;
      setAccent(a);
      setBrand(b);
      // The pre-paint script already wrote these; re-applying is idempotent and
      // covers the case where it was blocked.
      applyAccent(a, b);
    } catch {
      /* storage can throw in private mode — fall back to the defaults */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const setColors = useCallback(
    (next: { accent?: string; brand?: string }) => {
      const a = next.accent ? normalizeHex(next.accent) ?? accent : accent;
      const b = next.brand ? normalizeHex(next.brand) ?? brand : brand;
      setAccent(a);
      setBrand(b);
      applyAccent(a, b);
      try {
        localStorage.setItem(ACCENT_KEY, a);
        localStorage.setItem(BRAND_KEY, b);
      } catch {
        /* non-fatal */
      }
    },
    [accent, brand],
  );

  const resetColors = useCallback(() => {
    setAccent(DEFAULT_ACCENT);
    setBrand(DEFAULT_BRAND);
    applyAccent(DEFAULT_ACCENT, DEFAULT_BRAND);
    try {
      localStorage.removeItem(ACCENT_KEY);
      localStorage.removeItem(BRAND_KEY);
    } catch {
      /* non-fatal */
    }
  }, []);

  const value: ThemeValue = {
    theme,
    setTheme,
    accent,
    brand,
    setColors,
    resetColors,
    isCustomized: accent !== DEFAULT_ACCENT || brand !== DEFAULT_BRAND,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
