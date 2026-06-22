import { describe, expect, it } from "vitest";
import {
	isMacTerminalToggleShortcut,
	type TerminalShortcutEvent,
} from "../src/client/terminalShortcut.js";

function keyEvent(
	input: Partial<TerminalShortcutEvent>,
): TerminalShortcutEvent {
	return {
		key: "",
		code: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		isComposing: false,
		defaultPrevented: false,
		...input,
	};
}

describe("terminal shortcuts", () => {
	it("matches macOS terminal toggle shortcuts", () => {
		expect(
			isMacTerminalToggleShortcut(
				keyEvent({
					key: "`",
					code: "Backquote",
					ctrlKey: true,
				}),
				"MacIntel",
			),
		).toBe(true);
		expect(
			isMacTerminalToggleShortcut(
				keyEvent({
					key: "j",
					code: "KeyJ",
					metaKey: true,
				}),
				"MacIntel",
			),
		).toBe(true);
	});

	it("does not match non-macOS or modified key combinations", () => {
		expect(
			isMacTerminalToggleShortcut(
				keyEvent({
					key: "j",
					code: "KeyJ",
					metaKey: true,
				}),
				"Linux x86_64",
			),
		).toBe(false);
		expect(
			isMacTerminalToggleShortcut(
				keyEvent({
					key: "j",
					code: "KeyJ",
					metaKey: true,
					shiftKey: true,
				}),
				"MacIntel",
			),
		).toBe(false);
		expect(
			isMacTerminalToggleShortcut(
				keyEvent({
					key: "`",
					code: "Backquote",
					ctrlKey: true,
					defaultPrevented: true,
				}),
				"MacIntel",
			),
		).toBe(false);
	});
});
