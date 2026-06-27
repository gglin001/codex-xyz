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
		badge: "bg-control text-fg ring-1 ring-inset ring-border-soft",
		alert: "bg-detail/90 text-fg ring-border-soft",
	},
	selected: {
		badge: "bg-selected text-fg-strong ring-1 ring-inset ring-border",
		strong:
			"bg-selected-strong text-fg-strong ring-1 ring-inset ring-accent-soft shadow-[0_0_0_1px_rgba(168,200,255,0.08)]",
	},
	running: {
		dot: "bg-running-dot shadow-[0_0_10px_rgba(103,210,143,0.28)]",
		icon: "text-running-dot",
		badge: "bg-running text-running-fg ring-1 ring-inset ring-emerald-300/10",
		alert: "bg-emerald-400/8 text-running-fg ring-emerald-300/15",
	},
	stale: {
		dot: "bg-stale-dot",
		icon: "text-stale-dot",
		badge: "bg-stale text-stale-fg ring-1 ring-inset ring-yellow-200/10",
	},
	error: {
		dot: "bg-failed-dot",
		icon: "text-rose-300",
		badge: "bg-error text-error-fg ring-1 ring-inset ring-rose-300/10",
		alert: "bg-rose-400/10 text-rose-100 ring-rose-400/20",
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
	"transition-[border-color] duration-100 ease-out [transition-property:border-color,background-color] [transition-duration:100ms,200ms] [transition-delay:0s,30ms]";
const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
const interactiveRow = `${interactiveTransition} hover:bg-control-hover`;
const controlBase = `${radius.control} bg-control text-fg shadow-control ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong hover:ring-border ${focusRing} ${disabledState}`;
const sliderThumb =
	"[&::-webkit-slider-thumb]:h-[10px] [&::-webkit-slider-thumb]:w-[10px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-fg-strong [&::-webkit-slider-thumb]:shadow-none [&::-moz-range-thumb]:h-[10px] [&::-moz-range-thumb]:w-[10px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg-strong";

export const ui = {
	appShell: "bg-app-bg text-fg antialiased",
	workspaceCanvas: "bg-app-bg text-fg",
	sidePanel: "bg-panel/96 text-fg md:backdrop-blur-xl",
	topBar:
		"h-16 shrink-0 bg-app-bg/92 shadow-[inset_0_-1px_0_var(--border-soft)] md:backdrop-blur-xl",
	card: `overflow-hidden ${radius.card} bg-detail/92 shadow-card ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-surface/80 hover:ring-border`,
	outlineCard: `overflow-hidden ${radius.card} bg-surface-subtle/72 shadow-card ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-detail/76 hover:ring-border`,
	cardLarge: `overflow-hidden ${radius.cardLg} bg-detail/92 shadow-card ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-surface/80 hover:ring-border`,
	panelCard: `overflow-hidden ${radius.panel} bg-detail/92 shadow-panel ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-surface/80 hover:ring-border`,
	popover: `overflow-hidden ${radius.panel} bg-detail/96 shadow-popover ring-1 ring-inset ring-border md:backdrop-blur-md`,
	overlay: "bg-black/55 md:backdrop-blur-sm",
	backdropPanel:
		"bg-panel/96 shadow-popover ring-1 ring-inset ring-border-soft backdrop-blur-xl",
	controlBase,
	iconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-control text-muted-strong shadow-control ring-1 ring-inset ring-border-soft ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong hover:ring-border ${focusRing} ${disabledState} ${pressState}`,
	largeIconButton: `inline-flex h-9 w-9 shrink-0 items-center justify-center ${radius.nav} bg-transparent text-muted-strong shadow-none ring-1 ring-inset ring-transparent ${interactiveTransition} hover:bg-control hover:text-fg-strong hover:ring-border-soft active:bg-control-hover active:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
	composerIconButton: `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} bg-transparent text-muted-strong ring-1 ring-inset ring-transparent ${interactiveTransition} hover:bg-control hover:text-fg-strong hover:ring-border-soft disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${pressState}`,
	composerShell: `grid min-h-[104px] gap-2 ${radius.panel} bg-field/96 px-3.5 py-3 shadow-panel ring-1 ring-inset ring-border ${interactiveTransition} focus-within:bg-detail/80 focus-within:ring-2 focus-within:ring-focus-ring`,
	submitButton: `inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center gap-1.5 ${radius.control} bg-accent px-3 text-[13px] font-semibold text-accent-fg shadow-control ring-1 ring-inset ring-accent-soft ${interactiveTransition} hover:bg-accent disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted disabled:ring-border-soft`,
	buttonControl: `inline-flex items-center justify-center ${controlBase}`,
	surfaceButton: `flex min-w-0 items-center text-left ${radius.control} bg-detail/76 text-fg shadow-card ring-1 ring-inset ring-border-soft ${staggeredTransition} hover:bg-control hover:text-fg-strong hover:ring-border ${focusRing} ${disabledState} ${pressState}`,
	navButton: `flex min-w-0 items-center text-left ${radius.nav} text-fg ${staggeredTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState}`,
	navSelected:
		"bg-selected text-fg-strong shadow-control ring-1 ring-inset ring-border-soft",
	segmented: `inline-flex items-center ${radius.controlLg} bg-surface-subtle p-0.5 text-muted shadow-control ring-1 ring-inset ring-border-soft`,
	segment: `inline-flex h-8 items-center justify-center ${radius.control} px-3 text-[13px] font-medium ${interactiveTransition} hover:text-fg-strong ${focusRing}`,
	menuItem: `flex min-w-0 items-center text-left ${radius.control} ${interactiveRow}`,
	alert: `${radius.controlLg} px-3.5 py-2.5 text-[12px] ring-1 ring-inset`,
	iconBox: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-fg shadow-control ring-1 ring-inset ring-border-soft`,
	avatar: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-[12px] font-semibold text-fg shadow-control ring-1 ring-inset ring-border-soft`,
	selected:
		"bg-selected text-fg-strong shadow-control ring-1 ring-inset ring-border-soft",
	selectedStrong: tone.selected.strong,
	field: `${radius.control} bg-field text-muted shadow-control ring-1 ring-inset ring-border-soft ${interactiveTransition} focus-within:bg-surface-subtle focus-within:text-fg focus-within:ring-border ${focusRing}`,
	input:
		"min-w-0 flex-1 border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
	textarea:
		"block w-full resize-none border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
	range: `block h-2 w-full cursor-pointer appearance-none rounded-full bg-control accent-accent ring-1 ring-inset ring-border-soft ${sliderThumb} ${interactiveTransition} hover:bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`,
	row: interactiveRow,
	meta: "text-muted",
	subtleMeta: "text-[12px] text-muted",
	sectionLabel:
		"flex items-center gap-2 text-[11px] font-medium uppercase text-muted",
	pill: "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full bg-control px-1.5 text-[11px] font-medium leading-none text-fg ring-1 ring-inset ring-border-soft",
} as const;
