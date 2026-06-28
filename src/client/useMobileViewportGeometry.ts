import { useEffect } from "react";

type VirtualKeyboardNavigator = Navigator & {
	virtualKeyboard?: EventTarget & {
		boundingRect?: {
			height: number;
		};
	};
};

const appVisualHeightProperty = "--app-visual-height";
const keyboardInsetProperty = "--keyboard-inset-bottom";
const mobileSheetHeightProperty = "--mobile-sheet-height";
const mobileSheetTopProperty = "--mobile-sheet-top";
const keyboardVisibleAttribute = "data-keyboard-visible";
const mobileViewportQuery = "(max-width: 767px)";
const keyboardVisibilityThreshold = 80;

function setKeyboardState(insetValue: number) {
	const inset = Math.max(
		0,
		Math.round(insetValue > keyboardVisibilityThreshold ? insetValue : 0),
	);
	document.documentElement.style.setProperty(
		keyboardInsetProperty,
		`${inset}px`,
	);
	document.documentElement.toggleAttribute(keyboardVisibleAttribute, inset > 0);
}

function setAppVisualHeight(heightValue: number | null) {
	if (heightValue === null) {
		document.documentElement.style.setProperty(
			appVisualHeightProperty,
			"100dvh",
		);
		return;
	}
	document.documentElement.style.setProperty(
		appVisualHeightProperty,
		`${Math.max(320, Math.round(heightValue))}px`,
	);
}

function setMobileSheetGeometry(heightValue: number | null) {
	if (heightValue === null) {
		document.documentElement.style.setProperty(
			mobileSheetHeightProperty,
			"calc(var(--app-visual-height) - var(--safe-inset-top))",
		);
		document.documentElement.style.setProperty(
			mobileSheetTopProperty,
			"var(--safe-inset-top)",
		);
		return;
	}
	const viewportHeight = Math.max(320, Math.round(heightValue));
	document.documentElement.style.setProperty(
		mobileSheetHeightProperty,
		`calc(${viewportHeight}px - var(--safe-inset-top))`,
	);
	document.documentElement.style.setProperty(
		mobileSheetTopProperty,
		"var(--safe-inset-top)",
	);
}

function viewportHeight() {
	return window.visualViewport?.height ?? window.innerHeight;
}

function visualViewportKeyboardInset() {
	const viewport = window.visualViewport;
	if (!viewport) {
		return 0;
	}

	return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

function virtualKeyboardInset(
	virtualKeyboard: VirtualKeyboardNavigator["virtualKeyboard"],
) {
	return virtualKeyboard?.boundingRect?.height ?? 0;
}

function activeEditableElement() {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) {
		return false;
	}

	const tagName = active.tagName.toLowerCase();
	return (
		active.isContentEditable ||
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select"
	);
}

function visibleViewportHeight(
	keyboardInset: number,
	stableViewportHeight: number | null,
) {
	const currentViewportHeight = viewportHeight();
	if (keyboardInset <= keyboardVisibilityThreshold) {
		return currentViewportHeight;
	}

	const estimatedVisibleHeight =
		stableViewportHeight === null
			? currentViewportHeight
			: stableViewportHeight - keyboardInset;
	return Math.min(currentViewportHeight, estimatedVisibleHeight);
}

export function useMobileViewportGeometry() {
	useEffect(() => {
		const mobileQuery = window.matchMedia(mobileViewportQuery);
		const viewport = window.visualViewport;
		const virtualKeyboard = (window.navigator as VirtualKeyboardNavigator)
			.virtualKeyboard;
		let frame: number | null = null;
		let stableMobileViewportHeight: number | null = null;
		let keyboardWasVisible = false;

		const commit = () => {
			frame = null;

			if (!mobileQuery.matches) {
				setAppVisualHeight(null);
				setKeyboardState(0);
				setMobileSheetGeometry(null);
				stableMobileViewportHeight = null;
				keyboardWasVisible = false;
				return;
			}

			const currentViewportHeight = viewportHeight();
			if (stableMobileViewportHeight === null) {
				stableMobileViewportHeight = currentViewportHeight;
			}

			const viewportHeightDrop = Math.max(
				0,
				stableMobileViewportHeight - currentViewportHeight,
			);
			const resizeKeyboardInset =
				viewportHeightDrop > keyboardVisibilityThreshold &&
				(activeEditableElement() || keyboardWasVisible)
					? viewportHeightDrop
					: 0;
			const keyboardInset = Math.max(
				visualViewportKeyboardInset(),
				virtualKeyboardInset(virtualKeyboard),
				resizeKeyboardInset,
			);
			const keyboardVisible = keyboardInset > keyboardVisibilityThreshold;

			if (!keyboardVisible) {
				stableMobileViewportHeight = currentViewportHeight;
			} else {
				stableMobileViewportHeight = Math.max(
					stableMobileViewportHeight,
					currentViewportHeight + keyboardInset,
				);
			}

			setKeyboardState(keyboardInset);
			setAppVisualHeight(
				visibleViewportHeight(keyboardInset, stableMobileViewportHeight),
			);
			setMobileSheetGeometry(stableMobileViewportHeight);
			keyboardWasVisible = keyboardVisible;
		};

		const schedule = () => {
			if (frame !== null) {
				return;
			}
			frame = window.requestAnimationFrame(commit);
		};

		schedule();
		viewport?.addEventListener("resize", schedule);
		viewport?.addEventListener("scroll", schedule);
		virtualKeyboard?.addEventListener("geometrychange", schedule);
		window.addEventListener("focusin", schedule);
		window.addEventListener("focusout", schedule);
		window.addEventListener("resize", schedule);
		mobileQuery.addEventListener("change", schedule);

		return () => {
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
			viewport?.removeEventListener("resize", schedule);
			viewport?.removeEventListener("scroll", schedule);
			virtualKeyboard?.removeEventListener("geometrychange", schedule);
			window.removeEventListener("focusin", schedule);
			window.removeEventListener("focusout", schedule);
			window.removeEventListener("resize", schedule);
			mobileQuery.removeEventListener("change", schedule);
			setAppVisualHeight(null);
			setKeyboardState(0);
			setMobileSheetGeometry(null);
		};
	}, []);
}
