export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const radius = {
  control: "rounded-[8px]",
  controlLg: "rounded-[10px]",
  nav: "rounded-[8px]",
  card: "rounded-[8px]",
  cardLg: "rounded-[10px]",
  panel: "rounded-[12px]",
  sheet: "rounded-[16px]"
} as const

export const tone = {
  neutral: {
    dot: "bg-muted",
    badge: "border border-border bg-control text-fg",
    alert: "border-border bg-detail text-fg"
  },
  selected: {
    badge: "border border-border-strong bg-selected text-fg-strong",
    strong: "border-accent-soft bg-selected-strong text-fg-strong shadow-[0_0_0_1px_rgba(168,200,255,0.10)]"
  },
  running: {
    dot: "bg-running-dot shadow-[0_0_10px_rgba(103,210,143,0.28)]",
    icon: "text-running-dot",
    badge: "border border-emerald-300/15 bg-running text-running-fg",
    alert: "border-emerald-300/15 bg-emerald-400/8 text-running-fg"
  },
  stale: {
    dot: "bg-stale-dot",
    icon: "text-stale-dot",
    badge: "border border-yellow-200/15 bg-stale text-stale-fg"
  },
  error: {
    dot: "bg-failed-dot",
    icon: "text-rose-300",
    badge: "border border-rose-300/15 bg-error text-error-fg",
    alert: "border-rose-400/20 bg-rose-400/10 text-rose-100"
  },
  completed: {
    dot: "bg-completed-dot",
    icon: "text-muted"
  }
} as const

export const displayScale = {
  min: 0.8,
  max: 1.2,
  step: 0.05,
  defaultValue: 1
} as const

export function clampDisplayScale(value: number) {
  if (!Number.isFinite(value)) {
    return displayScale.defaultValue
  }
  const clamped = Math.min(displayScale.max, Math.max(displayScale.min, value))
  return Math.round(clamped / displayScale.step) * displayScale.step
}

export function formatDisplayScale(value: number) {
  return `${Math.round(value * 100)}%`
}

const interactiveTransition = "transition duration-150 ease-out"
const disabledState = "disabled:cursor-not-allowed disabled:opacity-40"
const pressState = "active:translate-y-px"
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
const interactiveRow = `${interactiveTransition} hover:bg-control-hover`
const controlBase = `${radius.control} border border-border bg-control text-fg shadow-control ${interactiveTransition} hover:border-border-strong hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState}`
const sliderThumb =
  "[&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border-strong [&::-webkit-slider-thumb]:bg-fg [&::-webkit-slider-thumb]:shadow-control [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border-strong [&::-moz-range-thumb]:bg-fg"

export const ui = {
  appShell: "bg-app-bg text-fg antialiased",
  workspaceCanvas: "bg-app-bg text-fg",
  sidePanel: "border-border bg-panel/92 text-fg backdrop-blur-xl",
  topBar: "h-16 shrink-0 border-b border-border bg-app-bg/88 backdrop-blur-xl",
  card: `overflow-hidden ${radius.card} border border-border bg-detail shadow-none ${interactiveTransition} hover:border-border-strong`,
  outlineCard: `overflow-hidden ${radius.card} border border-border bg-app-bg/70 shadow-none ${interactiveTransition} hover:border-border-strong hover:bg-detail/60`,
  cardLarge: `overflow-hidden ${radius.cardLg} border border-border bg-detail shadow-none ${interactiveTransition} hover:border-border-strong`,
  panelCard: `overflow-hidden ${radius.panel} border border-border bg-detail shadow-panel ${interactiveTransition} hover:border-border-strong`,
  popover: `overflow-hidden ${radius.panel} border border-border-strong bg-detail shadow-popover md:backdrop-blur-md`,
  overlay: "bg-black/55 md:backdrop-blur-sm",
  backdropPanel: "border-border bg-panel/92 shadow-popover backdrop-blur-xl",
  controlBase,
  iconButton:
    `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} border border-border bg-control text-muted-strong shadow-control ${interactiveTransition} hover:border-border-strong hover:bg-control-hover hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
  largeIconButton:
    `inline-flex h-9 w-9 shrink-0 items-center justify-center ${radius.nav} border border-transparent bg-transparent text-muted-strong shadow-none ${interactiveTransition} hover:border-border hover:bg-control hover:text-fg-strong active:bg-control-hover active:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
  composerIconButton:
    `inline-flex h-8 min-w-8 items-center justify-center ${radius.control} border border-transparent bg-transparent text-muted-strong ${interactiveTransition} hover:bg-control hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${pressState}`,
  composerShell:
    `grid min-h-[104px] gap-2 ${radius.panel} border border-border-strong bg-field px-3.5 py-3 shadow-panel ${interactiveTransition} focus-within:border-accent-soft focus-within:ring-2 focus-within:ring-focus-ring`,
  submitButton:
    `inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center gap-1.5 ${radius.control} border border-accent-soft bg-accent px-3 text-[13px] font-semibold text-accent-fg ${interactiveTransition} hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-surface-subtle disabled:text-muted`,
  buttonControl:
    `inline-flex items-center justify-center ${controlBase}`,
  surfaceButton:
    `flex min-w-0 items-center text-left ${radius.control} border border-border bg-detail text-fg shadow-none ${interactiveTransition} hover:border-border-strong hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState} ${pressState}`,
  navButton:
    `flex min-w-0 items-center text-left ${radius.nav} text-fg ${interactiveTransition} hover:bg-control hover:text-fg-strong ${focusRing} ${disabledState}`,
  navSelected: "border border-border-strong bg-selected text-fg-strong shadow-control",
  segmented:
    `inline-flex items-center ${radius.controlLg} border border-border bg-surface-subtle p-0.5 text-muted shadow-control`,
  segment:
    `inline-flex h-8 items-center justify-center ${radius.control} px-3 text-[13px] font-medium ${interactiveTransition} hover:text-fg-strong ${focusRing}`,
  menuItem:
    `flex min-w-0 items-center text-left ${radius.control} ${interactiveRow}`,
  alert: `${radius.controlLg} border px-3.5 py-2.5 text-[12px]`,
  iconBox: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-fg`,
  avatar: `flex shrink-0 items-center justify-center ${radius.control} border border-border bg-control text-[12px] font-semibold text-fg`,
  selected: "border border-border-strong bg-selected text-fg-strong",
  selectedStrong: tone.selected.strong,
  field:
    `${radius.control} border border-border bg-field text-muted shadow-control ${interactiveTransition} focus-within:border-border-strong focus-within:bg-surface-subtle focus-within:text-fg ${focusRing}`,
  input: "min-w-0 flex-1 border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
  textarea: "block w-full resize-none border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
  range:
    `h-2 w-full cursor-pointer appearance-none rounded-full border border-border bg-control accent-accent ${sliderThumb} ${interactiveTransition} hover:bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`,
  row: interactiveRow,
  meta: "text-muted",
  subtleMeta: "text-[12px] text-muted",
  sectionLabel: "flex items-center gap-2 text-[11px] font-medium uppercase text-muted",
  pill:
    "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-control px-1.5 text-[11px] font-medium leading-none text-fg"
} as const
