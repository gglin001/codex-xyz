export type ThemeMode = "dark" | "day";

export type TerminalTheme = {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
};

export const defaultThemeMode: ThemeMode = "dark";
export const themeModeStorageKey = "coz-theme-mode";

export const themeModeLabels: Record<ThemeMode, string> = {
	dark: "Dark mode",
	day: "Day mode",
};

const themeChromeColors: Record<ThemeMode, string> = {
	dark: "#131314",
	day: "#e8e9e6",
};

export function normalizeThemeMode(
	value: string | null | undefined,
): ThemeMode {
	return value === "day" || value === "dark" ? value : defaultThemeMode;
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
	return mode === "day" ? "dark" : "day";
}

export function readStoredThemeMode(): ThemeMode {
	if (typeof window === "undefined") {
		return defaultThemeMode;
	}
	try {
		return normalizeThemeMode(window.localStorage.getItem(themeModeStorageKey));
	} catch {
		return defaultThemeMode;
	}
}

export function writeStoredThemeMode(mode: ThemeMode) {
	try {
		window.localStorage.setItem(themeModeStorageKey, mode);
	} catch {
		// Keep the in-memory preference even if the browser blocks persistence.
	}
}

export function applyThemeMode(mode: ThemeMode) {
	if (typeof document === "undefined") {
		return;
	}
	document.documentElement.dataset.theme = mode;
	const metas = document.querySelectorAll<HTMLMetaElement>(
		'meta[name="theme-color"]',
	);
	if (metas.length === 0) {
		const meta = document.createElement("meta");
		meta.name = "theme-color";
		document.head.append(meta);
		meta.content = themeChromeColors[mode];
		return;
	}
	for (const meta of metas) {
		meta.content = themeChromeColors[mode];
	}
}

export function terminalTheme(mode: ThemeMode): TerminalTheme {
	if (mode === "day") {
		return {
			background: "#e2e4e0",
			foreground: "#252725",
			cursor: "#4f677c",
			selectionBackground: "#cfd7da",
			black: "#111312",
			red: "#9b2f42",
			green: "#2f6f45",
			yellow: "#7f621f",
			blue: "#4f677c",
			magenta: "#72577b",
			cyan: "#386f73",
			white: "#f5f5f2",
		};
	}

	return {
		background: "#0d0e10",
		foreground: "#e3e3e7",
		cursor: "#a8c8ff",
		selectionBackground: "#2c382d",
		black: "#131314",
		red: "#fb7185",
		green: "#67d28f",
		yellow: "#e2c26d",
		blue: "#a8c8ff",
		magenta: "#c4b5fd",
		cyan: "#67e8f9",
		white: "#f5f5f7",
	};
}
