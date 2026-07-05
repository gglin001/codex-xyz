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

export type TerminalQuickInputKey = {
	kind: "input";
	id: string;
	label: string;
	ariaLabel: string;
	data: string;
	controlData?: string;
};

export type TerminalQuickModifierKey = {
	kind: "modifier";
	id: "control";
	label: string;
	ariaLabel: string;
};

export type TerminalQuickKey = TerminalQuickInputKey | TerminalQuickModifierKey;

export const terminalQuickKeys = [
	{
		kind: "modifier",
		id: "control",
		label: "ctrl",
		ariaLabel: "Control modifier",
	},
	{
		kind: "input",
		id: "escape",
		label: "esc",
		ariaLabel: "Escape",
		data: "\x1b",
	},
	{
		kind: "input",
		id: "tab",
		label: "tab",
		ariaLabel: "Tab",
		data: "\t",
	},
	{
		kind: "input",
		id: "enter",
		label: "enter",
		ariaLabel: "Enter",
		data: "\r",
	},
	{
		kind: "input",
		id: "backspace",
		label: "bksp",
		ariaLabel: "Backspace",
		data: "\x7f",
		controlData: "\b",
	},
	{
		kind: "input",
		id: "arrow-up",
		label: "up",
		ariaLabel: "Arrow up",
		data: "\x1b[A",
		controlData: "\x1b[1;5A",
	},
	{
		kind: "input",
		id: "arrow-down",
		label: "down",
		ariaLabel: "Arrow down",
		data: "\x1b[B",
		controlData: "\x1b[1;5B",
	},
	{
		kind: "input",
		id: "arrow-left",
		label: "left",
		ariaLabel: "Arrow left",
		data: "\x1b[D",
		controlData: "\x1b[1;5D",
	},
	{
		kind: "input",
		id: "arrow-right",
		label: "right",
		ariaLabel: "Arrow right",
		data: "\x1b[C",
		controlData: "\x1b[1;5C",
	},
	{
		kind: "input",
		id: "home",
		label: "home",
		ariaLabel: "Home",
		data: "\x1b[H",
		controlData: "\x01",
	},
	{
		kind: "input",
		id: "end",
		label: "end",
		ariaLabel: "End",
		data: "\x1b[F",
		controlData: "\x05",
	},
	{
		kind: "input",
		id: "delete",
		label: "del",
		ariaLabel: "Delete",
		data: "\x1b[3~",
		controlData: "\x1b[3;5~",
	},
	{
		kind: "input",
		id: "key-c",
		label: "c",
		ariaLabel: "C",
		data: "c",
		controlData: "\x03",
	},
	{
		kind: "input",
		id: "key-d",
		label: "d",
		ariaLabel: "D",
		data: "d",
		controlData: "\x04",
	},
	{
		kind: "input",
		id: "key-l",
		label: "l",
		ariaLabel: "L",
		data: "l",
		controlData: "\x0c",
	},
] satisfies TerminalQuickKey[];

export function terminalQuickKeyInput(
	key: TerminalQuickKey,
	options: { control?: boolean } = {},
) {
	if (key.kind === "modifier") {
		return null;
	}
	return options.control && key.controlData ? key.controlData : key.data;
}

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
