import type {
	KeyboardEvent,
	PointerEvent as ReactPointerEvent,
	RefObject,
} from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../designSystem.js";
import {
	clamp,
	type MobileScrollMetrics,
	maxScrollTop,
	mobileScrollInitialMetrics,
	resolveMobileKeyboardScrollTop,
	resolveMobileScrollMetrics,
} from "../mobileScrollPhysics.js";

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

const hitAreaHalfWidth = "1.75rem";
const pillHalfWidth = "0.5rem";

export const MobileFloatingScroller = memo(function MobileFloatingScroller({
	scrollRef,
	scrollElementId,
	className,
	contentRightInset = hitAreaHalfWidth,
}: {
	scrollRef: RefObject<HTMLElement | null>;
	scrollElementId: string;
	className?: string;
	contentRightInset?: string;
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

		const nextMetrics = resolveMobileScrollMetrics({
			scrollHeight: scrollElement.scrollHeight,
			clientHeight: scrollElement.clientHeight,
			scrollTop: scrollElement.scrollTop,
			trackHeight: trackElement.clientHeight,
		});

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
			const scrollableTop = maxScrollTop(
				scrollElement.scrollHeight,
				scrollElement.clientHeight,
			);
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

			const nextTop = resolveMobileKeyboardScrollTop({
				key: event.key,
				scrollHeight: scrollElement.scrollHeight,
				clientHeight: scrollElement.clientHeight,
				scrollTop: scrollElement.scrollTop,
			});
			if (nextTop === null) {
				return;
			}

			event.preventDefault();
			scrollElement.scrollTo({
				top: nextTop,
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
				"mobile-floating-scroller pointer-events-none absolute bottom-4 right-0 top-4 z-[4] w-14 transition-opacity duration-150 ease-out",
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
					className="group pointer-events-auto absolute min-h-12 w-14 cursor-grab touch-none focus-visible:outline-none active:cursor-grabbing"
					style={{
						height: `${Math.round(metrics.thumbHeight)}px`,
						top: `${Math.round(metrics.thumbTop)}px`,
						right: `calc(max(${contentRightInset}, ${pillHalfWidth}) - ${hitAreaHalfWidth})`,
					}}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={endPointerDrag}
					onPointerCancel={endPointerDrag}
					onLostPointerCapture={cancelPointerDrag}
					onKeyDown={handleKeyDown}
				>
					<span
						aria-hidden="true"
						className={cn(
							"absolute left-1/2 top-1/2 h-9 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-muted/72 shadow-none transition-[background-color,border-color,opacity,transform] duration-150 ease-out group-focus-visible:ring-2 group-focus-visible:ring-muted-strong",
							dragging
								? "scale-105 bg-muted-strong/88"
								: "group-hover:scale-[1.04] group-hover:bg-muted/82",
						)}
					/>
				</div>
			</div>
		</div>
	);
});
