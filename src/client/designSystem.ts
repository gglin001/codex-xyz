export function cn(...values: Array<string | false | null | undefined>) {
	return values.filter(Boolean).join(" ");
}

export const radius = {
	control: "rounded-[8px]",
	controlLg: "rounded-[10px]",
	nav: "rounded-[8px]",
	card: "rounded-[8px]",
	cardLg: "rounded-[10px]",
	panel: "rounded-[12px]",
	sheet: "rounded-[16px]",
} as const;

export const tone = {
	neutral: {
		dot: "bg-muted",
		badge: "bg-control text-fg",
		alert: "bg-detail/90 text-fg",
	},
	selected: {
		badge: "bg-selected text-fg-strong",
		strong: "bg-selected-strong text-fg-strong",
	},
	running: {
		dot: "bg-running-dot shadow-[0_0_10px_rgba(103,210,143,0.28)]",
		icon: "text-running-dot",
		badge: "bg-running text-running-fg",
		alert: "bg-emerald-400/8 text-running-fg",
	},
	stale: {
		dot: "bg-stale-dot",
		icon: "text-stale-dot",
		badge: "bg-stale text-stale-fg",
	},
	error: {
		dot: "bg-failed-dot",
		icon: "text-rose-300",
		badge: "bg-error text-error-fg",
		alert: "bg-rose-400/10 text-rose-100",
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
const pressState = "active:translate-y-px";
const staggeredTransition =
	"transition-[background-color,color] duration-150 ease-out";
const focusRing =
	"focus-visible:outline-none focus-visible:bg-control-hover focus-visible:text-fg-strong";
const textInputFocus = "focus-within:bg-field focus-within:text-fg";
const interactiveRow = `${interactiveTransition} hover:bg-control-hover`;
const controlBase = `${radius.control} bg-control text-fg ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState}`;
const sliderThumb =
	"[&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-fg-strong [&::-webkit-slider-thumb]:shadow-none [&::-moz-range-thumb]:h-[10px] [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg-strong";

export const ui = {
	appShell: "bg-app-bg text-fg antialiased",
	workspaceCanvas: "bg-app-bg text-fg",
	sidePanel: "bg-panel/96 text-fg md:backdrop-blur-xl",
	topBar: "h-16 shrink-0 bg-app-bg/92 md:backdrop-blur-xl",
	card: `overflow-hidden ${radius.card} bg-detail/92 ${interactiveTransition} hover:bg-surface/80`,
	outlineCard: `overflow-hidden ${radius.card} bg-surface-subtle/72 ${interactiveTransition} hover:bg-detail/76`,
	cardLarge: `overflow-hidden ${radius.cardLg} bg-detail/92 ${interactiveTransition} hover:bg-surface/80`,
	panelCard: `overflow-hidden ${radius.panel} bg-detail/92 ${interactiveTransition} hover:bg-surface/80`,
	popover: `overflow-hidden ${radius.panel} bg-detail/96 md:backdrop-blur-md`,
	overlay: "bg-black/55 md:backdrop-blur-sm",
	backdropPanel: "bg-panel/96 backdrop-blur-xl",
	controlBase,
	iconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-control text-muted-strong ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	largeIconButton: `inline-flex h-9 w-9 shrink-0 items-center justify-center ${radius.nav} bg-transparent text-muted-strong shadow-none ${interactiveTransition} hover:bg-control hover:text-fg-strong active:bg-control-hover active:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	composerIconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-transparent text-muted-strong ${interactiveTransition} hover:bg-control hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${pressState}`,
	composerShell: `grid min-h-0 gap-1.5 ${radius.panel} bg-field/80 px-3 py-2 shadow-none ${interactiveTransition} hover:bg-field/92 ${textInputFocus}`,
	submitButton: `inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center gap-1.5 ${radius.control} bg-accent px-3 text-[13px] font-semibold text-accent-fg ${interactiveTransition} hover:bg-accent disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted`,
	buttonControl: `inline-flex items-center justify-center ${controlBase}`,
	surfaceButton: `flex min-w-0 items-center text-left ${radius.control} bg-detail/76 text-fg ${staggeredTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	navButton: `flex min-w-0 items-center text-left ${radius.nav} text-fg ${staggeredTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState}`,
	navSelected: "bg-selected text-fg-strong",
	segmented: `inline-flex items-center ${radius.controlLg} bg-surface-subtle p-0.5 text-muted`,
	segment: `inline-flex h-8 items-center justify-center ${radius.control} px-3 text-[13px] font-medium ${interactiveTransition} hover:text-fg-strong ${focusRing}`,
	menuItem: `flex min-w-0 items-center text-left ${radius.control} ${interactiveRow}`,
	alert: `${radius.controlLg} px-3.5 py-2.5 text-[12px]`,
	iconBox: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-fg`,
	avatar: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-[12px] font-semibold text-fg`,
	selected: "bg-selected text-fg-strong",
	selectedStrong: tone.selected.strong,
	field: `${radius.control} bg-field/72 text-muted shadow-none ${interactiveTransition} hover:bg-field/88 ${textInputFocus}`,
	input:
		"min-h-0 min-w-0 flex-1 border-0 bg-transparent py-0 text-fg-strong caret-accent placeholder:text-muted focus:outline-none focus-visible:outline-none disabled:opacity-60",
	textarea:
		"block w-full resize-none border-0 bg-transparent py-0 text-fg-strong caret-accent placeholder:text-muted focus:outline-none focus-visible:outline-none disabled:opacity-60",
	range: `block h-2 w-full cursor-pointer appearance-none rounded-full bg-control accent-accent ${sliderThumb} ${interactiveTransition} hover:bg-control-hover focus-visible:outline-none focus-visible:bg-control-hover`,
	row: interactiveRow,
	meta: "text-muted",
	subtleMeta: "text-[12px] text-muted",
	sectionLabel:
		"flex items-center gap-2 text-[11px] font-medium uppercase text-muted",
	pill: "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full bg-control px-1.5 text-[11px] font-medium leading-none text-fg",
} as const;
