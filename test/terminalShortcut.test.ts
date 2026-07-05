import { describe, expect, it } from "vitest";
import {
	isMacTerminalToggleShortcut,
	type TerminalShortcutEvent,
	terminalQuickKeyInput,
	terminalQuickKeys,
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

	it("maps terminal quick keys to pty input sequences", () => {
		const inputs = new Map(
			terminalQuickKeys
				.map((key) => [key.id, terminalQuickKeyInput(key)] as const)
				.filter(
					(entry): entry is readonly [string, string] => entry[1] !== null,
				),
		);

		expect(inputs.get("escape")).toBe("\x1b");
		expect(inputs.get("tab")).toBe("\t");
		expect(inputs.get("enter")).toBe("\r");
		expect(inputs.get("arrow-up")).toBe("\x1b[A");
		expect(inputs.get("arrow-down")).toBe("\x1b[B");
		expect(inputs.get("arrow-left")).toBe("\x1b[D");
		expect(inputs.get("arrow-right")).toBe("\x1b[C");
	});

	it("maps terminal quick keys to Control-modified sequences", () => {
		const inputFor = (id: string) => {
			const key = terminalQuickKeys.find((candidate) => candidate.id === id);
			if (!key) {
				throw new Error(`Missing quick key: ${id}`);
			}
			return terminalQuickKeyInput(key, { control: true });
		};

		expect(inputFor("key-c")).toBe("\x03");
		expect(inputFor("key-d")).toBe("\x04");
		expect(inputFor("key-l")).toBe("\x0c");
		expect(inputFor("arrow-left")).toBe("\x1b[1;5D");
		expect(inputFor("arrow-right")).toBe("\x1b[1;5C");
	});
});
