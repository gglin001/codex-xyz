import { useEffect } from "react";

const mobileViewportQuery = "(max-width: 767px)";
const editableSelector =
	'input:not([type="range"]), textarea, select, [contenteditable="true"]';
const longPressDelayMs = 360;
const suppressionAfterTouchMs = 700;
const moveTolerancePx = 10;

type ActiveTouch = {
	id: number;
	x: number;
	y: number;
	timer: number;
	longPress: boolean;
};

function isEditableTarget(target: EventTarget | null) {
	return target instanceof Element && Boolean(target.closest(editableSelector));
}

function movedBeyondTolerance(touch: Touch, active: ActiveTouch) {
	return (
		Math.abs(touch.clientX - active.x) > moveTolerancePx ||
		Math.abs(touch.clientY - active.y) > moveTolerancePx
	);
}

export function useMobileLongPressSelectionGuard() {
	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			return;
		}

		const mobileQuery = window.matchMedia(mobileViewportQuery);
		let activeTouch: ActiveTouch | null = null;
		let suppressUntil = 0;

		const clearActiveTouch = (keepSuppression: boolean) => {
			if (!activeTouch) {
				return;
			}
			window.clearTimeout(activeTouch.timer);
			if (keepSuppression && activeTouch.longPress) {
				suppressUntil = performance.now() + suppressionAfterTouchMs;
			}
			activeTouch = null;
		};

		const clearDocumentSelection = () => {
			window.getSelection()?.removeAllRanges();
		};

		const suppressionActive = () =>
			Boolean(activeTouch?.longPress) || performance.now() < suppressUntil;

		const onTouchStart = (event: TouchEvent) => {
			if (
				!mobileQuery.matches ||
				event.touches.length !== 1 ||
				isEditableTarget(event.target)
			) {
				clearActiveTouch(false);
				return;
			}

			clearActiveTouch(false);
			const touch = event.touches[0];
			activeTouch = {
				id: touch.identifier,
				x: touch.clientX,
				y: touch.clientY,
				longPress: false,
				timer: window.setTimeout(() => {
					if (!activeTouch) {
						return;
					}
					activeTouch.longPress = true;
					clearDocumentSelection();
				}, longPressDelayMs),
			};
		};

		const onTouchMove = (event: TouchEvent) => {
			if (!activeTouch) {
				return;
			}
			const touch = Array.from(event.changedTouches).find(
				(candidate) => candidate.identifier === activeTouch?.id,
			);
			if (touch && movedBeyondTolerance(touch, activeTouch)) {
				clearActiveTouch(false);
			}
		};

		const onTouchEnd = () => {
			clearActiveTouch(true);
		};

		const preventLongPressSelection = (event: Event) => {
			if (
				!mobileQuery.matches ||
				isEditableTarget(event.target) ||
				!suppressionActive()
			) {
				return;
			}
			event.preventDefault();
			clearDocumentSelection();
		};

		const clearSuppressedSelection = () => {
			if (mobileQuery.matches && suppressionActive()) {
				clearDocumentSelection();
			}
		};

		document.addEventListener("touchstart", onTouchStart, { passive: true });
		document.addEventListener("touchmove", onTouchMove, { passive: true });
		document.addEventListener("touchend", onTouchEnd, { passive: true });
		document.addEventListener("touchcancel", onTouchEnd, { passive: true });
		document.addEventListener("selectstart", preventLongPressSelection, {
			capture: true,
		});
		document.addEventListener("contextmenu", preventLongPressSelection, {
			capture: true,
		});
		document.addEventListener("selectionchange", clearSuppressedSelection);

		return () => {
			clearActiveTouch(false);
			document.removeEventListener("touchstart", onTouchStart);
			document.removeEventListener("touchmove", onTouchMove);
			document.removeEventListener("touchend", onTouchEnd);
			document.removeEventListener("touchcancel", onTouchEnd);
			document.removeEventListener("selectstart", preventLongPressSelection, {
				capture: true,
			});
			document.removeEventListener("contextmenu", preventLongPressSelection, {
				capture: true,
			});
			document.removeEventListener("selectionchange", clearSuppressedSelection);
		};
	}, []);
}
