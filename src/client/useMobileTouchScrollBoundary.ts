import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { maxScrollTop } from "./mobileScrollPhysics.js";

const mobileViewportQuery = "(max-width: 767px)";
const verticalIntentThresholdPx = 2;
const scrollBoundaryTolerancePx = 1;

type TouchStart = {
	id: number;
	x: number;
	y: number;
	scrollElement: HTMLElement | null;
};

export type MobileTouchScrollMetrics = {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
} | null;

export function shouldPreventMobileScrollChain({
	dx,
	dy,
	scrollMetrics,
	strictVertical = false,
}: {
	dx: number;
	dy: number;
	scrollMetrics: MobileTouchScrollMetrics;
	strictVertical?: boolean;
}) {
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (absY <= verticalIntentThresholdPx || absY <= absX) {
		return false;
	}
	if (strictVertical) {
		return true;
	}
	if (!scrollMetrics) {
		return true;
	}

	const scrollableTop = maxScrollTop(
		scrollMetrics.scrollHeight,
		scrollMetrics.clientHeight,
	);
	if (scrollableTop <= scrollBoundaryTolerancePx) {
		return true;
	}

	const scrollTop = Math.min(
		scrollableTop,
		Math.max(0, scrollMetrics.scrollTop),
	);
	const atTop = scrollTop <= scrollBoundaryTolerancePx;
	const atBottom = scrollTop >= scrollableTop - scrollBoundaryTolerancePx;

	if (dy > 0) {
		return atTop;
	}
	return atBottom;
}

function isVerticalScrollContainer(element: HTMLElement) {
	const style = window.getComputedStyle(element);
	if (!["auto", "scroll", "overlay"].includes(style.overflowY)) {
		return false;
	}
	return maxScrollTop(element.scrollHeight, element.clientHeight) > 0;
}

function closestVerticalScrollContainer(
	target: EventTarget | null,
	root: HTMLElement,
) {
	if (!(target instanceof Element)) {
		return null;
	}

	let element: Element | null = target;
	while (element && element instanceof HTMLElement) {
		if (isVerticalScrollContainer(element)) {
			return element;
		}
		if (element === root) {
			break;
		}
		element = element.parentElement;
	}
	return null;
}

function touchById(touchList: TouchList, id: number) {
	return Array.from(touchList).find((touch) => touch.identifier === id) ?? null;
}

function metricsFor(element: HTMLElement | null): MobileTouchScrollMetrics {
	if (!element?.isConnected) {
		return null;
	}
	return {
		scrollTop: element.scrollTop,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
	};
}

export function useMobileTouchScrollBoundary(
	rootRef: RefObject<HTMLElement | null>,
	enabled: boolean,
	options: { strictVertical?: boolean } = {},
) {
	const startRef = useRef<TouchStart | null>(null);
	const strictVertical = options.strictVertical ?? false;

	useEffect(() => {
		if (!enabled || typeof window.matchMedia !== "function") {
			startRef.current = null;
			return;
		}

		const root = rootRef.current;
		if (!root) {
			startRef.current = null;
			return;
		}

		const mobileQuery = window.matchMedia(mobileViewportQuery);

		const onTouchStart = (event: TouchEvent) => {
			if (!mobileQuery.matches || event.touches.length !== 1) {
				startRef.current = null;
				return;
			}

			const touch = event.touches[0];
			startRef.current = {
				id: touch.identifier,
				x: touch.clientX,
				y: touch.clientY,
				scrollElement: closestVerticalScrollContainer(event.target, root),
			};
		};

		const onTouchMove = (event: TouchEvent) => {
			const start = startRef.current;
			if (!start || !mobileQuery.matches || event.touches.length !== 1) {
				return;
			}

			const touch = touchById(event.changedTouches, start.id);
			if (!touch) {
				return;
			}

			if (
				shouldPreventMobileScrollChain({
					dx: touch.clientX - start.x,
					dy: touch.clientY - start.y,
					scrollMetrics: metricsFor(start.scrollElement),
					strictVertical,
				}) &&
				event.cancelable
			) {
				event.preventDefault();
			}
		};

		const onTouchEnd = () => {
			startRef.current = null;
		};

		root.addEventListener("touchstart", onTouchStart, { capture: true });
		root.addEventListener("touchmove", onTouchMove, {
			capture: true,
			passive: false,
		});
		root.addEventListener("touchend", onTouchEnd, { capture: true });
		root.addEventListener("touchcancel", onTouchEnd, { capture: true });

		return () => {
			startRef.current = null;
			root.removeEventListener("touchstart", onTouchStart, {
				capture: true,
			});
			root.removeEventListener("touchmove", onTouchMove, { capture: true });
			root.removeEventListener("touchend", onTouchEnd, { capture: true });
			root.removeEventListener("touchcancel", onTouchEnd, { capture: true });
		};
	}, [enabled, rootRef, strictVertical]);
}
