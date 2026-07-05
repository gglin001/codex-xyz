import { useEffect } from "react";

export type ShellPanelShortcutEvent = {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing: boolean;
	defaultPrevented: boolean;
};

export type ShellPanelShortcutAction = "toggleNavigator" | "toggleInspector";

export type ShellPanelShortcutHandlers = {
	onToggleNavigator: () => void;
	onToggleInspector: () => void;
};

function isMacPlatform(platform: string) {
	return platform.toLowerCase().includes("mac");
}

function isKeyB(event: ShellPanelShortcutEvent) {
	return event.code === "KeyB" || event.key.toLowerCase() === "b";
}

export function shellPanelShortcutAction(
	event: ShellPanelShortcutEvent,
	platform: string,
): ShellPanelShortcutAction | null {
	if (
		!isMacPlatform(platform) ||
		event.defaultPrevented ||
		event.isComposing ||
		!event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		!isKeyB(event)
	) {
		return null;
	}

	return event.altKey ? "toggleInspector" : "toggleNavigator";
}

export function useShellPanelShortcuts({
	onToggleNavigator,
	onToggleInspector,
}: ShellPanelShortcutHandlers) {
	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			const action = shellPanelShortcutAction(event, window.navigator.platform);
			if (!action) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			if (action === "toggleNavigator") {
				onToggleNavigator();
				return;
			}
			onToggleInspector();
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [onToggleInspector, onToggleNavigator]);
}
