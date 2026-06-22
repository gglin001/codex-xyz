import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export type SwipeHandlers = {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	onSwipeUp?: () => void;
	onSwipeDown?: () => void;
};

export type SwipeDirection = "left" | "right" | "up" | "down";

export type SwipeGestureOptions = {
	enabled?: boolean;
	threshold?: number;
	directionThresholds?: Partial<Record<SwipeDirection, number>>;
	axisLockRatio?: number;
	edgeSize?: number;
	ignoreInteractive?: boolean;
};

type SwipeStart = {
	x: number;
	y: number;
	nearLeftEdge: boolean;
	nearRightEdge: boolean;
};

type SwipeDirectionResolution = {
	dx: number;
	dy: number;
	threshold?: number;
	directionThresholds?: Partial<Record<SwipeDirection, number>>;
	axisLockRatio?: number;
	nearLeftEdge?: boolean;
	nearRightEdge?: boolean;
};

const interactiveTargetSelector = [
	"button",
	"a",
	"input",
	"select",
	"textarea",
	"[role='button']",
	"[data-swipe-ignore='true']",
].join(",");

function isInteractiveTarget(target: EventTarget | null) {
	return (
		target instanceof Element &&
		target.closest(interactiveTargetSelector) !== null
	);
}

function thresholdForDirection(
	direction: SwipeDirection,
	threshold: number,
	directionThresholds: Partial<Record<SwipeDirection, number>> | undefined,
) {
	return directionThresholds?.[direction] ?? threshold;
}

export function resolveSwipeDirection({
	dx,
	dy,
	threshold = 60,
	directionThresholds,
	axisLockRatio = 1,
	nearLeftEdge = true,
	nearRightEdge = true,
}: SwipeDirectionResolution): SwipeDirection | null {
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);

	if (absDx >= absDy * axisLockRatio) {
		if (dx <= 0) {
			if (absDx < thresholdForDirection("left", threshold, directionThresholds))
				return null;
			if (!nearRightEdge) return null;
			return "left";
		}
		if (absDx < thresholdForDirection("right", threshold, directionThresholds))
			return null;
		if (!nearLeftEdge) return null;
		return "right";
	}

	if (absDy < absDx * axisLockRatio) return null;
	if (dy <= 0) {
		if (absDy < thresholdForDirection("up", threshold, directionThresholds))
			return null;
		return "up";
	}
	if (absDy < thresholdForDirection("down", threshold, directionThresholds))
		return null;
	return "down";
}

/**
 * Listens for touch-swipe gestures on `elementRef` and fires the
 * corresponding handler when the dominant movement exceeds `threshold`.
 */
export function useSwipeGesture(
	elementRef: RefObject<HTMLElement | null>,
	handlers: SwipeHandlers,
	options: SwipeGestureOptions = {},
) {
	const {
		enabled = true,
		threshold = 60,
		directionThresholds,
		axisLockRatio = 1,
		edgeSize,
		ignoreInteractive = false,
	} = options;
	const startRef = useRef<SwipeStart | null>(null);

	useEffect(() => {
		if (
			!enabled ||
			(!handlers.onSwipeLeft &&
				!handlers.onSwipeRight &&
				!handlers.onSwipeUp &&
				!handlers.onSwipeDown)
		) {
			return;
		}
		const el = elementRef.current;
		if (!el) return;

		const onTouchStart = (event: TouchEvent) => {
			if (
				event.touches.length !== 1 ||
				(ignoreInteractive && isInteractiveTarget(event.target))
			) {
				startRef.current = null;
				return;
			}
			const touch = event.touches[0];
			const viewportWidth = window.innerWidth;
			startRef.current = {
				x: touch.clientX,
				y: touch.clientY,
				nearLeftEdge: edgeSize === undefined || touch.clientX <= edgeSize,
				nearRightEdge:
					edgeSize === undefined || touch.clientX >= viewportWidth - edgeSize,
			};
		};

		const onTouchEnd = (event: TouchEvent) => {
			const start = startRef.current;
			startRef.current = null;
			if (!start || event.changedTouches.length !== 1) return;
			const dx = event.changedTouches[0].clientX - start.x;
			const dy = event.changedTouches[0].clientY - start.y;
			const direction = resolveSwipeDirection({
				dx,
				dy,
				threshold,
				directionThresholds,
				axisLockRatio,
				nearLeftEdge: start.nearLeftEdge,
				nearRightEdge: start.nearRightEdge,
			});

			if (direction === "left") {
				handlers.onSwipeLeft?.();
			} else if (direction === "right") {
				handlers.onSwipeRight?.();
			} else if (direction === "up") {
				handlers.onSwipeUp?.();
			} else if (direction === "down") {
				handlers.onSwipeDown?.();
			}
		};

		const onTouchCancel = () => {
			startRef.current = null;
		};

		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchend", onTouchEnd, { passive: true });
		el.addEventListener("touchcancel", onTouchCancel, { passive: true });

		return () => {
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchend", onTouchEnd);
			el.removeEventListener("touchcancel", onTouchCancel);
		};
	}, [
		edgeSize,
		elementRef,
		enabled,
		directionThresholds,
		axisLockRatio,
		handlers.onSwipeLeft,
		handlers.onSwipeRight,
		handlers.onSwipeUp,
		handlers.onSwipeDown,
		ignoreInteractive,
		threshold,
	]);
}
