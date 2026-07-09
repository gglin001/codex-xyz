export type MobileScrollMetrics = {
	canScroll: boolean;
	thumbHeight: number;
	thumbTop: number;
	progress: number;
};

export type MobileScrollMetricInput = {
	scrollHeight: number;
	clientHeight: number;
	scrollTop: number;
	trackHeight: number;
	thumbHeight?: number;
};

export type MobileScrollKeyInput = {
	key: string;
	scrollHeight: number;
	clientHeight: number;
	scrollTop: number;
};

export type ScrollAnchorMetricInput = {
	anchorTop: number;
	scrollHeight: number;
	clientHeight: number;
	trackHeight: number;
	thumbHeight?: number;
	markerSize?: number;
};

export type ScrollAnchorMetric = {
	top: number;
	scrollTop: number;
	progress: number;
};

export const mobileScrollThumbHeight = 48;
export const mobileScrollMinScrollableDistance = 16;
export const mobileScrollKeyboardPageRatio = 0.82;
export const scrollAnchorMarkerSize = 8;

export const mobileScrollInitialMetrics: MobileScrollMetrics = {
	canScroll: false,
	thumbHeight: mobileScrollThumbHeight,
	thumbTop: 0,
	progress: 0,
};

export function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

export function maxScrollTop(scrollHeight: number, clientHeight: number) {
	if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) {
		return 0;
	}
	return Math.max(0, scrollHeight - clientHeight);
}

function arrowStepForHeight(clientHeight: number) {
	return clamp(clientHeight * 0.14, 56, 112);
}

export function resolveMobileScrollMetrics({
	scrollHeight,
	clientHeight,
	scrollTop,
	trackHeight,
	thumbHeight = mobileScrollThumbHeight,
}: MobileScrollMetricInput): MobileScrollMetrics {
	const scrollableTop = maxScrollTop(scrollHeight, clientHeight);
	if (
		scrollableTop < mobileScrollMinScrollableDistance ||
		trackHeight <= thumbHeight
	) {
		return mobileScrollInitialMetrics;
	}

	const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
	const progress = clamp(scrollTop / scrollableTop, 0, 1);

	return {
		canScroll: true,
		thumbHeight,
		thumbTop: progress * maxThumbTop,
		progress,
	};
}

export function resolveScrollAnchorMetric({
	anchorTop,
	scrollHeight,
	clientHeight,
	trackHeight,
	thumbHeight = mobileScrollThumbHeight,
	markerSize = scrollAnchorMarkerSize,
}: ScrollAnchorMetricInput): ScrollAnchorMetric | null {
	if (
		!Number.isFinite(anchorTop) ||
		!Number.isFinite(scrollHeight) ||
		!Number.isFinite(clientHeight) ||
		!Number.isFinite(trackHeight) ||
		scrollHeight <= 0 ||
		trackHeight <= 0 ||
		trackHeight <= thumbHeight
	) {
		return null;
	}

	const scrollableTop = maxScrollTop(scrollHeight, clientHeight);
	if (scrollableTop <= 0) {
		return null;
	}

	const markerHalfSize = Math.max(0, markerSize / 2);
	const clampedAnchorTop = clamp(anchorTop, 0, scrollHeight);
	const scrollTop = clamp(clampedAnchorTop, 0, scrollableTop);
	const progress = scrollTop / scrollableTop;
	const visualTop = thumbHeight / 2 + progress * (trackHeight - thumbHeight);

	return {
		top: clamp(visualTop, markerHalfSize, trackHeight - markerHalfSize),
		scrollTop,
		progress,
	};
}

export function resolveMobileKeyboardScrollTop({
	key,
	scrollHeight,
	clientHeight,
	scrollTop,
}: MobileScrollKeyInput) {
	const scrollableTop = maxScrollTop(scrollHeight, clientHeight);
	let nextTop = scrollTop;

	if (key === "ArrowUp") {
		nextTop -= arrowStepForHeight(clientHeight);
	} else if (key === "ArrowDown") {
		nextTop += arrowStepForHeight(clientHeight);
	} else if (key === "PageUp") {
		nextTop -= clientHeight * mobileScrollKeyboardPageRatio;
	} else if (key === "PageDown") {
		nextTop += clientHeight * mobileScrollKeyboardPageRatio;
	} else if (key === "Home") {
		nextTop = 0;
	} else if (key === "End") {
		nextTop = scrollableTop;
	} else {
		return null;
	}

	return clamp(nextTop, 0, scrollableTop);
}
