import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { maxScrollTop } from "./mobileScrollPhysics.js";

const mobileViewportQuery = "(max-width: 767px)";
const gestureIntentThresholdPx = 2;
const scrollBoundaryTolerancePx = 1;

type TouchStart = {
	id: number;
	x: number;
	y: number;
	horizontalScrollElement: HTMLElement | null;
	verticalScrollElement: HTMLElement | null;
};

export type MobileTouchScrollMetrics = {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
} | null;

export type MobileTouchHorizontalScrollMetrics = {
	scrollLeft: number;
	scrollWidth: number;
	clientWidth: number;
} | null;

export function shouldPreventMobileScrollChain({
	dx,
	dy,
	horizontalScrollMetrics,
	scrollMetrics,
}: {
	dx: number;
	dy: number;
	horizontalScrollMetrics?: MobileTouchHorizontalScrollMetrics;
	scrollMetrics: MobileTouchScrollMetrics;
}) {
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (absX > gestureIntentThresholdPx && absX > absY) {
		if (horizontalScrollMetrics === undefined) {
			return false;
		}
		if (!horizontalScrollMetrics) {
			return true;
		}

		const scrollableLeft = maxScrollTop(
			horizontalScrollMetrics.scrollWidth,
			horizontalScrollMetrics.clientWidth,
		);
		if (scrollableLeft <= scrollBoundaryTolerancePx) {
			return true;
		}

		const scrollLeft = Math.min(
			scrollableLeft,
			Math.max(0, horizontalScrollMetrics.scrollLeft),
		);
		const atLeft = scrollLeft <= scrollBoundaryTolerancePx;
		const atRight = scrollLeft >= scrollableLeft - scrollBoundaryTolerancePx;

		if (dx > 0) {
			return atLeft;
		}
		return atRight;
	}

	if (absY <= gestureIntentThresholdPx || absY <= absX) {
		return false;
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

function isScrollContainer(element: HTMLElement, axis: "x" | "y") {
	const style = window.getComputedStyle(element);
	const overflow = axis === "x" ? style.overflowX : style.overflowY;
	if (!["auto", "scroll", "overlay"].includes(overflow)) {
		return false;
	}
	const scrollSize = axis === "x" ? element.scrollWidth : element.scrollHeight;
	const clientSize = axis === "x" ? element.clientWidth : element.clientHeight;
	return maxScrollTop(scrollSize, clientSize) > 0;
}

function closestScrollContainer(
	target: EventTarget | null,
	root: HTMLElement,
	axis: "x" | "y",
) {
	if (!(target instanceof Element)) {
		return null;
	}

	let element: Element | null = target;
	while (element && element instanceof HTMLElement) {
		if (isScrollContainer(element, axis)) {
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

function horizontalMetricsFor(
	element: HTMLElement | null,
): MobileTouchHorizontalScrollMetrics {
	if (!element?.isConnected) {
		return null;
	}
	return {
		scrollLeft: element.scrollLeft,
		scrollWidth: element.scrollWidth,
		clientWidth: element.clientWidth,
	};
}

export function useMobileTouchScrollBoundary(
	rootRef: RefObject<HTMLElement | null>,
	enabled: boolean,
) {
	const startRef = useRef<TouchStart | null>(null);

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
				horizontalScrollElement: closestScrollContainer(
					event.target,
					root,
					"x",
				),
				verticalScrollElement: closestScrollContainer(event.target, root, "y"),
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
					horizontalScrollMetrics: horizontalMetricsFor(
						start.horizontalScrollElement,
					),
					scrollMetrics: metricsFor(start.verticalScrollElement),
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
	}, [enabled, rootRef]);
}
