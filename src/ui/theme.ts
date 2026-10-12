export type ThemePreference = "auto" | "light" | "dark";

const STORAGE_KEY = "turbofuzz-theme";

/** Cycles Auto → Light → Dark → Auto. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "auto") return "light";
  if (current === "light") return "dark";
  return "auto";
}

/** The theme actually painted for a preference (Auto follows the OS). */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): "light" | "dark" {
  if (preference === "auto") return prefersDark ? "dark" : "light";
  return preference;
}

export function themeLabel(preference: ThemePreference): string {
  return preference === "auto" ? "Auto" : preference === "light" ? "Light" : "Dark";
}

function isPreference(value: string | null): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPreference(stored)) return stored;
  } catch {
    // Storage can be blocked; Auto is the safe default.
  }
  return "auto";
}

/**
 * Applies the preference to the document: explicit themes pin `data-theme`
 * (the stylesheet keeps a duplicate palette for each), Auto removes it so the
 * `prefers-color-scheme` media query decides. Fires a `themechange` event so
 * canvas charts can repaint with the new CSS variables.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);

  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.style.colorScheme = resolveTheme(preference, prefersDark);
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
  window.dispatchEvent(new Event("themechange"));
}
