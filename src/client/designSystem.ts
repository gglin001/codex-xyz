export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const radius = {
  control: "rounded-[16px]",
  controlLg: "rounded-[18px]",
  nav: "rounded-[22px]",
  card: "rounded-[18px]",
  cardLg: "rounded-[20px]",
  panel: "rounded-[24px]",
  sheet: "rounded-[28px]"
} as const

export const tone = {
  neutral: {
    dot: "bg-muted",
    badge: "bg-control text-fg",
    alert: "border-border bg-detail text-fg"
  },
  selected: {
    badge: "bg-selected text-fg-strong",
    strong: "border-white/15 bg-selected-strong text-fg-strong shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
  },
  running: {
    dot: "bg-running-dot shadow-[0_0_12px_rgba(103,210,143,0.38)]",
    icon: "text-running-dot",
    badge: "bg-running text-running-fg",
    alert: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
  },
  stale: {
    dot: "bg-stale-dot",
    icon: "text-stale-dot",
    badge: "bg-stale text-stale-fg"
  },
  error: {
    dot: "bg-failed-dot",
    icon: "text-rose-300",
    badge: "bg-error text-error-fg",
    alert: "border-rose-400/20 bg-rose-400/10 text-rose-100"
  },
  completed: {
    dot: "bg-completed-dot",
    icon: "text-muted"
  }
} as const

const interactiveTransition = "transition duration-150 ease-out"
const disabledState = "disabled:cursor-not-allowed disabled:opacity-40"
const pressState = "active:scale-[0.98]"
const interactiveRow = `${interactiveTransition} hover:bg-surface`
const controlBase = `${radius.controlLg} border border-border bg-control text-fg ${interactiveTransition} hover:border-border-strong hover:bg-control-hover hover:text-fg-strong ${disabledState}`

export const ui = {
  appShell: "bg-app-bg text-fg antialiased",
  workspaceCanvas: "bg-app-bg text-fg",
  sidePanel: "border-border bg-panel text-fg",
  topBar: "h-16 shrink-0 bg-app-bg",
  card: `overflow-hidden ${radius.card} border border-border bg-detail shadow-control ${interactiveTransition} hover:border-border-strong`,
  outlineCard: `overflow-hidden ${radius.card} border border-border-strong bg-app-bg shadow-none ${interactiveTransition} hover:border-border-strong`,
  cardLarge: `overflow-hidden ${radius.cardLg} border border-border bg-detail shadow-control ${interactiveTransition} hover:border-border-strong`,
  panelCard: `overflow-hidden ${radius.panel} border border-border bg-detail shadow-panel ${interactiveTransition} hover:border-border-strong`,
  popover: `overflow-hidden ${radius.panel} border border-border bg-detail shadow-popover md:backdrop-blur-md`,
  overlay: "bg-black/60 md:backdrop-blur-sm",
  backdropPanel: "border-border bg-panel shadow-popover",
  controlBase,
  iconButton:
    `inline-flex h-9 min-w-9 items-center justify-center ${radius.control} border border-border bg-control text-muted-strong shadow-control ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong ${disabledState} ${pressState}`,
  largeIconButton:
    `inline-flex h-10 w-10 shrink-0 items-center justify-center ${radius.nav} border border-border bg-transparent text-muted-strong shadow-none ${interactiveTransition} hover:border-border-strong hover:text-fg-strong active:bg-control-hover active:text-fg-strong active:shadow-control ${disabledState} ${pressState}`,
  composerIconButton:
    `inline-flex h-9 min-w-9 items-center justify-center ${radius.control} border border-transparent bg-control text-fg ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35 ${pressState}`,
  composerShell:
    `grid min-h-[96px] gap-2 ${radius.panel} border border-border-strong bg-surface px-3.5 py-2.5 shadow-panel ${interactiveTransition} focus-within:border-white/20 focus-within:ring-2 focus-within:ring-focus-ring`,
  submitButton:
    `inline-flex h-9 min-w-[76px] shrink-0 items-center justify-center gap-1.5 ${radius.controlLg} border border-border bg-control px-3 text-[13px] font-semibold text-fg ${interactiveTransition} hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-surface-subtle disabled:text-[#4f4f4f]`,
  buttonControl:
    `inline-flex items-center justify-center ${controlBase}`,
  surfaceButton:
    `flex min-w-0 items-center text-left ${radius.controlLg} border border-border bg-detail text-fg ${interactiveTransition} hover:border-border-strong hover:bg-surface hover:text-fg-strong ${disabledState}`,
  navButton:
    `flex min-w-0 items-center text-left ${radius.nav} text-fg ${interactiveTransition} hover:bg-surface hover:text-fg-strong ${disabledState}`,
  navSelected: "bg-control text-fg-strong shadow-control",
  segmented:
    `inline-flex items-center ${radius.panel} border border-border bg-surface-subtle p-1 text-muted shadow-control`,
  segment:
    `inline-flex h-9 items-center justify-center ${radius.controlLg} px-3.5 text-[13px] font-medium ${interactiveTransition} hover:text-fg-strong`,
  menuItem:
    `flex min-w-0 items-center text-left ${radius.control} ${interactiveRow}`,
  alert: `${radius.controlLg} border px-3.5 py-2.5 text-[12px]`,
  iconBox: `flex shrink-0 items-center justify-center ${radius.control} bg-control text-fg`,
  avatar: `flex shrink-0 items-center justify-center ${radius.control} border border-border bg-control text-[12px] font-semibold text-fg`,
  selected: "bg-selected text-fg-strong ring-1 ring-white/10",
  selectedStrong: tone.selected.strong,
  field:
    `${radius.controlLg} border border-border bg-field text-muted ${interactiveTransition} focus-within:border-border-strong focus-within:bg-surface focus-within:text-fg`,
  input: "min-w-0 flex-1 border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
  textarea: "block w-full resize-none border-0 bg-transparent text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60",
  row: interactiveRow,
  meta: "text-muted",
  subtleMeta: "text-[12px] text-muted",
  sectionLabel: "flex items-center gap-2 text-[12px] font-medium text-muted",
  pill:
    "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-control px-1.5 text-[10px] font-medium leading-none text-fg"
} as const
