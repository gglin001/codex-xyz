import { describe, expect, it } from "vitest";
import {
	type ShellPanelShortcutEvent,
	shellPanelShortcutAction,
} from "../src/client/shellShortcuts.js";

function keyEvent(
	input: Partial<ShellPanelShortcutEvent>,
): ShellPanelShortcutEvent {
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

describe("shell panel shortcuts", () => {
	it("matches macOS navigator and inspector toggles", () => {
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "b",
					code: "KeyB",
					metaKey: true,
				}),
				"MacIntel",
			),
		).toBe("toggleNavigator");
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "∫",
					code: "KeyB",
					metaKey: true,
					altKey: true,
				}),
				"MacIntel",
			),
		).toBe("toggleInspector");
	});

	it("does not match non-macOS, handled, composing, or extra modifier events", () => {
		expect(
			shellPanelShortcutAction(
				keyEvent({ key: "b", code: "KeyB", metaKey: true }),
				"Linux x86_64",
			),
		).toBeNull();
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "b",
					code: "KeyB",
					metaKey: true,
					defaultPrevented: true,
				}),
				"MacIntel",
			),
		).toBeNull();
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "b",
					code: "KeyB",
					metaKey: true,
					isComposing: true,
				}),
				"MacIntel",
			),
		).toBeNull();
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "b",
					code: "KeyB",
					metaKey: true,
					shiftKey: true,
				}),
				"MacIntel",
			),
		).toBeNull();
		expect(
			shellPanelShortcutAction(
				keyEvent({
					key: "b",
					code: "KeyB",
					metaKey: true,
					ctrlKey: true,
				}),
				"MacIntel",
			),
		).toBeNull();
	});
});
