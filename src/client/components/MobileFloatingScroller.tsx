import type {
	KeyboardEvent,
	PointerEvent as ReactPointerEvent,
	RefObject,
} from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem.js";

const mobileScrollPillHeight = 48;
const mobileScrollKeyboardStep = 72;
const mobileScrollKeyboardPageRatio = 0.82;

type MobileScrollMetrics = {
	canScroll: boolean;
	thumbHeight: number;
	thumbTop: number;
	progress: number;
};

const mobileScrollInitialMetrics: MobileScrollMetrics = {
	canScroll: false,
	thumbHeight: mobileScrollPillHeight,
	thumbTop: 0,
	progress: 0,
};

function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

function maxScrollTop(element: HTMLElement) {
	return Math.max(0, element.scrollHeight - element.clientHeight);
}

function scrollMetricsEqual(
	current: MobileScrollMetrics,
	next: MobileScrollMetrics,
) {
	return (
		current.canScroll === next.canScroll &&
		Math.abs(current.thumbHeight - next.thumbHeight) < 0.5 &&
		Math.abs(current.thumbTop - next.thumbTop) < 0.5 &&
		Math.abs(current.progress - next.progress) < 0.002
	);
}

export const MobileFloatingScroller = memo(function MobileFloatingScroller({
	scrollRef,
	scrollElementId,
	className,
}: {
	scrollRef: RefObject<HTMLElement | null>;
	scrollElementId: string;
	className?: string;
}) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const thumbRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef<{
		pointerId: number;
		pointerOffsetY: number;
	} | null>(null);
	const [metrics, setMetrics] = useState<MobileScrollMetrics>(
		mobileScrollInitialMetrics,
	);
	const [dragging, setDragging] = useState(false);
	const [isMobileViewport, setIsMobileViewport] = useState(false);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 767px)");
		const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
		updateViewport();
		mediaQuery.addEventListener("change", updateViewport);
		return () => {
			mediaQuery.removeEventListener("change", updateViewport);
		};
	}, []);

	const updateMetrics = useCallback(() => {
		const scrollElement = scrollRef.current;
		const trackElement = trackRef.current;
		if (!scrollElement || !trackElement) {
			setMetrics((current) =>
				scrollMetricsEqual(current, mobileScrollInitialMetrics)
					? current
					: mobileScrollInitialMetrics,
			);
			return;
		}

		const trackHeight = trackElement.clientHeight;
		const scrollableTop = maxScrollTop(scrollElement);
		if (scrollableTop <= 1 || trackHeight <= mobileScrollPillHeight) {
			setMetrics((current) =>
				scrollMetricsEqual(current, mobileScrollInitialMetrics)
					? current
					: mobileScrollInitialMetrics,
			);
			return;
		}

		const thumbHeight = mobileScrollPillHeight;
		const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
		const progress = clamp(scrollElement.scrollTop / scrollableTop, 0, 1);
		const nextMetrics = {
			canScroll: true,
			thumbHeight,
			thumbTop: progress * maxThumbTop,
			progress,
		};

		setMetrics((current) =>
			scrollMetricsEqual(current, nextMetrics) ? current : nextMetrics,
		);
	}, [scrollRef]);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) {
			return;
		}

		let frame: number | null = null;
		const scheduleUpdate = () => {
			if (frame !== null) {
				return;
			}
			frame = window.requestAnimationFrame(() => {
				frame = null;
				updateMetrics();
			});
		};

		scrollElement.addEventListener("scroll", scheduleUpdate, {
			passive: true,
		});
		window.addEventListener("resize", scheduleUpdate);

		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(scheduleUpdate);
		resizeObserver?.observe(scrollElement);
		const contentElement = scrollElement.firstElementChild;
		if (contentElement instanceof HTMLElement) {
			resizeObserver?.observe(contentElement);
		}

		const mutationObserver =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver(scheduleUpdate);
		mutationObserver?.observe(scrollElement, {
			childList: true,
			characterData: true,
			subtree: true,
		});

		scheduleUpdate();

		return () => {
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
			scrollElement.removeEventListener("scroll", scheduleUpdate);
			window.removeEventListener("resize", scheduleUpdate);
			resizeObserver?.disconnect();
			mutationObserver?.disconnect();
		};
	}, [scrollRef, updateMetrics]);

	useEffect(() => {
		if (!isMobileViewport) {
			return;
		}
		const frame = window.requestAnimationFrame(updateMetrics);
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [isMobileViewport, updateMetrics]);

	const scrollToPointer = useCallback(
		(clientY: number, pointerOffsetY: number) => {
			const scrollElement = scrollRef.current;
			const trackElement = trackRef.current;
			if (!scrollElement || !trackElement) {
				return;
			}

			const trackRect = trackElement.getBoundingClientRect();
			const maxThumbTop = Math.max(
				0,
				trackElement.clientHeight - metrics.thumbHeight,
			);
			const scrollableTop = maxScrollTop(scrollElement);
			if (maxThumbTop <= 0 || scrollableTop <= 0) {
				return;
			}

			const nextThumbTop = clamp(
				clientY - trackRect.top - pointerOffsetY,
				0,
				maxThumbTop,
			);
			scrollElement.scrollTop = (nextThumbTop / maxThumbTop) * scrollableTop;
			updateMetrics();
		},
		[metrics.thumbHeight, scrollRef, updateMetrics],
	);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!metrics.canScroll) {
				return;
			}
			if (event.pointerType === "mouse" && event.button !== 0) {
				return;
			}

			const thumbElement = thumbRef.current;
			const pointerOffsetY = thumbElement
				? clamp(
						event.clientY - thumbElement.getBoundingClientRect().top,
						0,
						metrics.thumbHeight,
					)
				: metrics.thumbHeight / 2;

			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragStateRef.current = {
				pointerId: event.pointerId,
				pointerOffsetY,
			};
			setDragging(true);
		},
		[metrics.canScroll, metrics.thumbHeight],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const dragState = dragStateRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}
			event.preventDefault();
			scrollToPointer(event.clientY, dragState.pointerOffsetY);
		},
		[scrollToPointer],
	);

	const endPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const dragState = dragStateRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}
			event.preventDefault();
			dragStateRef.current = null;
			setDragging(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		[],
	);

	const cancelPointerDrag = useCallback(() => {
		dragStateRef.current = null;
		setDragging(false);
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			const scrollElement = scrollRef.current;
			if (!scrollElement || !metrics.canScroll) {
				return;
			}

			let nextTop = scrollElement.scrollTop;
			if (event.key === "ArrowUp") {
				nextTop -= mobileScrollKeyboardStep;
			} else if (event.key === "ArrowDown") {
				nextTop += mobileScrollKeyboardStep;
			} else if (event.key === "PageUp") {
				nextTop -= scrollElement.clientHeight * mobileScrollKeyboardPageRatio;
			} else if (event.key === "PageDown") {
				nextTop += scrollElement.clientHeight * mobileScrollKeyboardPageRatio;
			} else if (event.key === "Home") {
				nextTop = 0;
			} else if (event.key === "End") {
				nextTop = maxScrollTop(scrollElement);
			} else {
				return;
			}

			event.preventDefault();
			scrollElement.scrollTo({
				top: clamp(nextTop, 0, maxScrollTop(scrollElement)),
				behavior: "auto",
			});
			updateMetrics();
		},
		[metrics.canScroll, scrollRef, updateMetrics],
	);

	return (
		<div
			data-scrollable={metrics.canScroll ? "true" : "false"}
			className={cn(
				"mobile-floating-scroller pointer-events-none absolute bottom-4 right-2.5 top-4 z-[4] w-8 transition-opacity duration-150 ease-out",
				metrics.canScroll ? "opacity-100" : "opacity-0",
				className,
			)}
			aria-hidden={metrics.canScroll ? undefined : true}
			style={{ display: isMobileViewport ? "block" : "none" }}
		>
			<div ref={trackRef} className="relative h-full w-full">
				<div
					ref={thumbRef}
					role="scrollbar"
					tabIndex={metrics.canScroll ? 0 : -1}
					aria-label="Scroll content"
					aria-controls={scrollElementId}
					aria-orientation="vertical"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(metrics.progress * 100)}
					className={cn(
						"pointer-events-auto absolute right-1 h-12 w-5 cursor-grab touch-none rounded-full border border-border-strong bg-muted/58 shadow-none transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-strong active:cursor-grabbing",
						dragging
							? "scale-105 bg-muted-strong/78"
							: "hover:scale-[1.04] hover:bg-muted/72",
					)}
					style={{
						height: `${Math.round(metrics.thumbHeight)}px`,
						top: `${Math.round(metrics.thumbTop)}px`,
					}}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={endPointerDrag}
					onPointerCancel={endPointerDrag}
					onLostPointerCapture={cancelPointerDrag}
					onKeyDown={handleKeyDown}
				/>
			</div>
		</div>
	);
});
