export type TerminalShortcutEvent = {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing: boolean;
	defaultPrevented: boolean;
};

export function isMacPlatform(platform: string) {
	return platform.toLowerCase().includes("mac");
}

export function isMacTerminalToggleShortcut(
	event: TerminalShortcutEvent,
	platform: string,
) {
	if (
		!isMacPlatform(platform) ||
		event.defaultPrevented ||
		event.isComposing ||
		event.altKey ||
		event.shiftKey
	) {
		return false;
	}

	const key = event.key.toLowerCase();
	const isCommandJ = event.metaKey && !event.ctrlKey && key === "j";
	const isControlBackquote =
		event.ctrlKey &&
		!event.metaKey &&
		(event.code === "Backquote" || event.key === "`");
	return isCommandJ || isControlBackquote;
}
