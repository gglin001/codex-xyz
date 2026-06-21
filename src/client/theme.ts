export type ThemeMode = "dark" | "day"

export type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
}

export const defaultThemeMode: ThemeMode = "dark"
export const themeModeStorageKey = "codex-xyz-theme-mode"

export const themeModeLabels: Record<ThemeMode, string> = {
  dark: "Dark mode",
  day: "Day mode"
}

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  return value === "day" || value === "dark" ? value : defaultThemeMode
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "day" ? "dark" : "day"
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return defaultThemeMode
  }
  try {
    return normalizeThemeMode(window.localStorage.getItem(themeModeStorageKey))
  } catch {
    return defaultThemeMode
  }
}

export function writeStoredThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(themeModeStorageKey, mode)
  } catch {
    // Keep the in-memory preference even if the browser blocks persistence.
  }
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return
  }
  document.documentElement.dataset.theme = mode
}

export function terminalTheme(mode: ThemeMode): TerminalTheme {
  if (mode === "day") {
    return {
      background: "#f5f5f7",
      foreground: "#1d1d1f",
      cursor: "#007aff",
      selectionBackground: "#cfe3ff",
      black: "#1d1d1f",
      red: "#d70015",
      green: "#248a3d",
      yellow: "#b26a00",
      blue: "#007aff",
      magenta: "#af52de",
      cyan: "#0071a4",
      white: "#ffffff"
    }
  }

  return {
    background: "#0b0d0c",
    foreground: "#d8ded7",
    cursor: "#a8c8ff",
    selectionBackground: "#2c382d",
    black: "#151816",
    red: "#fb7185",
    green: "#67d28f",
    yellow: "#e2c26d",
    blue: "#a8c8ff",
    magenta: "#c4b5fd",
    cyan: "#67e8f9",
    white: "#f3f7f0"
  }
}
