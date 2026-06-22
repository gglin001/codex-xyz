import { describe, expect, it } from "vitest";
import {
	isPromptFocusShortcut,
	type PromptFocusShortcutEvent,
} from "../src/client/promptShortcut.js";

function keyEvent(
	input: Partial<PromptFocusShortcutEvent>,
): PromptFocusShortcutEvent {
	return {
		key: "",
		code: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		isComposing: false,
		defaultPrevented: false,
		target: null,
		...input,
	};
}

function targetElement(input: {
	tagName?: string;
	isContentEditable?: boolean;
	closestEditable?: boolean;
}) {
	return {
		tagName: input.tagName,
		isContentEditable: input.isContentEditable ?? false,
		closest: () => (input.closestEditable ? {} : null),
	} as unknown as EventTarget;
}

describe("prompt shortcuts", () => {
	it("matches an unmodified slash outside editable controls", () => {
		expect(isPromptFocusShortcut(keyEvent({ key: "/" }))).toBe(true);
		expect(
			isPromptFocusShortcut(keyEvent({ key: "Unidentified", code: "Slash" })),
		).toBe(true);
	});

	it("does not match modified, composing, or handled key events", () => {
		expect(isPromptFocusShortcut(keyEvent({ key: "/", metaKey: true }))).toBe(
			false,
		);
		expect(isPromptFocusShortcut(keyEvent({ key: "/", ctrlKey: true }))).toBe(
			false,
		);
		expect(isPromptFocusShortcut(keyEvent({ key: "/", altKey: true }))).toBe(
			false,
		);
		expect(
			isPromptFocusShortcut(
				keyEvent({ key: "?", code: "Slash", shiftKey: true }),
			),
		).toBe(false);
		expect(
			isPromptFocusShortcut(keyEvent({ key: "/", isComposing: true })),
		).toBe(false);
		expect(
			isPromptFocusShortcut(keyEvent({ key: "/", defaultPrevented: true })),
		).toBe(false);
	});

	it("does not steal slash input from editable targets", () => {
		expect(
			isPromptFocusShortcut(
				keyEvent({ key: "/", target: targetElement({ tagName: "INPUT" }) }),
			),
		).toBe(false);
		expect(
			isPromptFocusShortcut(
				keyEvent({ key: "/", target: targetElement({ tagName: "TEXTAREA" }) }),
			),
		).toBe(false);
		expect(
			isPromptFocusShortcut(
				keyEvent({ key: "/", target: targetElement({ tagName: "SELECT" }) }),
			),
		).toBe(false);
		expect(
			isPromptFocusShortcut(
				keyEvent({
					key: "/",
					target: targetElement({ isContentEditable: true }),
				}),
			),
		).toBe(false);
		expect(
			isPromptFocusShortcut(
				keyEvent({
					key: "/",
					target: targetElement({ closestEditable: true }),
				}),
			),
		).toBe(false);
	});
});
