export type PromptFocusShortcutEvent = {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing: boolean;
	defaultPrevented: boolean;
	target: EventTarget | null;
};

type PotentialElement = {
	tagName?: string;
	isContentEditable?: boolean;
	closest?: (selector: string) => unknown;
};

const editableSelector = "input, textarea, select, [contenteditable='true']";

function isEditableTarget(target: EventTarget | null) {
	if (!target || typeof target !== "object") {
		return false;
	}

	const element = target as PotentialElement;
	const tagName = element.tagName?.toLowerCase();
	if (tagName === "input" || tagName === "textarea" || tagName === "select") {
		return true;
	}
	if (element.isContentEditable) {
		return true;
	}
	if (typeof element.closest === "function") {
		return Boolean(element.closest(editableSelector));
	}
	return false;
}

export function isPromptFocusShortcut(event: PromptFocusShortcutEvent) {
	if (
		event.defaultPrevented ||
		event.isComposing ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		event.shiftKey ||
		isEditableTarget(event.target)
	) {
		return false;
	}

	return event.key === "/" || event.code === "Slash";
}
