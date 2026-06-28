export function cn(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}

export const radius = {
	control: "rounded-[8px]",
	controlLg: "rounded-[8px]",
	nav: "rounded-[8px]",
	card: "rounded-[8px]",
	cardLg: "rounded-[8px]",
	panel: "rounded-[12px]",
	sheet: "rounded-[12px]",
} as const;

export const motionPresets = {
	spring: { type: "spring", stiffness: 360, damping: 36 },
	sheet: { type: "spring", stiffness: 360, damping: 36 },
	item: { type: "spring", stiffness: 360, damping: 34 },
	quick: { type: "spring", stiffness: 420, damping: 34 },
} as const;

export const layer = {
	composerZ: "z-[90]",
	workspaceChromeZ: "z-[110]",
	overlayZ: "z-[120]",
	localBackdropZ: "z-[10]",
	localFloatingZ: "z-[20]",
	localMenuZ: "z-[30]",
	mobileHandle: "h-1 w-12 rounded-full bg-control-hover/88",
	mobileSheet:
		"mobile-sheet-surface absolute inset-x-0 top-[var(--mobile-sheet-top)] flex h-[var(--mobile-sheet-height)] flex-col overflow-hidden rounded-t-[12px] md:rounded-[12px]",
	mobileTerminalSheet:
		"mobile-sheet-surface pointer-events-auto absolute inset-x-0 top-[var(--mobile-sheet-top)] flex h-[var(--mobile-sheet-height)] flex-col overflow-hidden rounded-t-[12px] md:inset-auto md:rounded-[12px]",
	groupContinuationMark:
		"absolute -bottom-1 left-3.5 h-2 w-1 rounded-full bg-control-hover",
	stackedIconPlate:
		"absolute left-1 top-1 h-6 w-8 rounded-[8px] bg-surface-subtle/52",
} as const;

export const tone = {
	neutral: {
		dot: "bg-muted",
		badge: "bg-control text-fg",
		alert: "bg-control text-fg",
	},
	selected: {
		badge: "bg-selected text-fg-strong",
		strong: "bg-selected-strong text-fg-strong",
	},
	running: {
		dot: "bg-running-dot",
		icon: "text-running-dot",
		badge: "bg-running text-running-fg",
		alert: "bg-success text-success-fg",
	},
	stale: {
		dot: "bg-stale-dot",
		icon: "text-stale-dot",
		badge: "bg-stale text-stale-fg",
	},
	error: {
		dot: "bg-failed-dot",
		icon: "text-error-fg",
		badge: "bg-error text-error-fg",
		alert: "bg-error text-error-fg",
	},
	completed: {
		dot: "bg-completed-dot",
		icon: "text-muted",
	},
} as const;

export const displayScale = {
	min: 0.8,
	max: 1.2,
	step: 0.05,
	defaultValue: 1,
} as const;

export function clampDisplayScale(value: number) {
	if (!Number.isFinite(value)) {
		return displayScale.defaultValue;
	}
	const clamped = Math.min(displayScale.max, Math.max(displayScale.min, value));
	return Math.round(clamped / displayScale.step) * displayScale.step;
}

export function formatDisplayScale(value: number) {
	return `${Math.round(value * 100)}%`;
}

const interactiveTransition = "transition duration-150 ease-out";
const disabledState = "disabled:cursor-not-allowed disabled:opacity-40";
const pressState = "active:bg-control-hover";
const staggeredTransition =
	"transition-[background-color,color] duration-150 ease-out";
const focusRing =
	"focus-visible:outline-none focus-visible:bg-control-hover focus-visible:text-fg-strong";
const textInputFocus =
	"focus-within:bg-control focus-within:text-fg-strong focus-within:outline-none";
const interactiveRow = `${interactiveTransition} hover:bg-control-hover`;
const controlBase = `${radius.control} bg-control/88 text-fg ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState}`;
const sliderThumb =
	"[&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-fg-strong [&::-webkit-slider-thumb]:shadow-none [&::-moz-range-thumb]:h-[10px] [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg-strong";

export const ui = {
	appShell: "bg-app-bg text-fg antialiased",
	workspaceCanvas: "bg-app-bg text-fg",
	sidePanel: "bg-panel/90 text-fg md:backdrop-blur-xl",
	topBar: "h-16 shrink-0 bg-app-bg/92 md:backdrop-blur-xl",
	card: `overflow-hidden ${radius.card} bg-surface-subtle/62 ${interactiveTransition} hover:bg-surface-subtle/78`,
	outlineCard: `overflow-hidden ${radius.card} bg-surface-subtle/46 ${interactiveTransition} hover:bg-surface-subtle/70`,
	cardLarge: `overflow-hidden ${radius.cardLg} bg-surface-subtle/62 ${interactiveTransition} hover:bg-surface-subtle/78`,
	panelCard: `overflow-hidden ${radius.panel} bg-surface-subtle/62 ${interactiveTransition} hover:bg-surface-subtle/78`,
	popover: `overflow-hidden ${radius.panel} bg-panel/98 shadow-none md:backdrop-blur-md`,
	overlay: "bg-app-bg/70 md:bg-app-bg/62 md:backdrop-blur-sm",
	backdropPanel: "bg-panel/96 shadow-none backdrop-blur-xl",
	panelBand: "bg-transparent",
	panelBandStrong: "bg-surface-subtle/16",
	controlBase,
	iconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-control/72 text-muted-strong ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	largeIconButton: `inline-flex h-9 w-9 shrink-0 items-center justify-center ${radius.nav} bg-transparent text-muted-strong shadow-none ${interactiveTransition} hover:bg-control hover:text-fg-strong active:bg-control-hover active:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	compactIconButton: `inline-flex h-7 w-7 shrink-0 items-center justify-center ${radius.control} bg-transparent text-muted ${interactiveTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	compactIconState: `shrink-0 items-center justify-center ${radius.control} bg-transparent text-muted ${interactiveTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	composerIconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-transparent text-muted-strong ${interactiveTransition} hover:bg-control hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${pressState}`,
	composerShell: `grid min-h-0 gap-1 ${radius.panel} bg-field/72 px-3 py-1.5 shadow-none ${interactiveTransition} hover:bg-field/86 ${textInputFocus}`,
	submitButton: `inline-flex h-8 w-8 shrink-0 items-center justify-center ${radius.control} bg-accent p-0 text-[13px] font-semibold text-accent-fg ${interactiveTransition} hover:bg-accent disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted`,
	buttonControl: `inline-flex items-center justify-center ${controlBase}`,
	surfaceButton: `flex min-w-0 items-center text-left ${radius.control} bg-surface-subtle/52 text-fg ${staggeredTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	navButton: `flex min-w-0 items-center text-left ${radius.nav} text-fg ${staggeredTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState}`,
	navSelected: "bg-selected text-fg-strong",
	segmented: `inline-flex items-center ${radius.controlLg} bg-surface-subtle/70 p-0.5 text-muted`,
	segment: `inline-flex h-8 items-center justify-center ${radius.control} px-3 text-[13px] font-medium ${interactiveTransition} hover:text-fg-strong ${focusRing}`,
	menuItem: `flex min-w-0 items-center text-left ${radius.control} ${interactiveRow}`,
	alert: `${radius.controlLg} px-3.5 py-2.5 text-[12px]`,
	alertDismissButton: `inline-flex h-6 w-6 shrink-0 items-center justify-center ${radius.control} text-current opacity-70 ${interactiveTransition} hover:bg-control-hover hover:opacity-100 focus-visible:bg-control-hover focus-visible:outline-none`,
	iconBox: `flex shrink-0 items-center justify-center ${radius.control} bg-control/76 text-fg`,
	avatar: `flex shrink-0 items-center justify-center ${radius.control} bg-control/76 text-[12px] font-semibold text-fg`,
	selected: "bg-selected text-fg-strong",
	selectedStrong: tone.selected.strong,
	field: `${radius.control} bg-field/66 text-muted shadow-none ${interactiveTransition} hover:bg-field/82 ${textInputFocus}`,
	input:
		"min-h-0 min-w-0 flex-1 border-0 bg-transparent py-0 text-fg-strong caret-accent placeholder:text-muted focus:outline-none focus-visible:outline-none disabled:opacity-60",
	textarea:
		"block w-full resize-none border-0 bg-transparent py-0 text-fg-strong caret-accent placeholder:text-muted focus:outline-none focus-visible:outline-none disabled:opacity-60",
	inputText: "h-[1lh] text-[14px] leading-5",
	inputTextCompact: "h-[1lh] text-[13px] leading-5",
	range: `block h-2 w-full cursor-pointer appearance-none rounded-full bg-control accent-accent ${sliderThumb} ${interactiveTransition} hover:bg-control-hover focus-visible:outline-none focus-visible:bg-control-hover`,
	row: interactiveRow,
	meta: "text-muted",
	subtleMeta: "text-[12px] text-muted",
	sectionLabel: "flex items-center gap-2 text-[12px] font-medium text-muted",
	pill: "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full bg-control px-1.5 text-[11px] font-medium leading-none text-fg",
} as const;
