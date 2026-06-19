export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const iconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent text-muted-strong transition duration-200 ease-snappy hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]"

export const subtleIconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border-soft bg-control/40 text-muted-strong shadow-control transition duration-200 ease-snappy hover:border-border hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]"

export const activeIconButtonClass =
  "border-border bg-accent-soft text-fg-strong shadow-control"

export const pillClass =
  "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-md border border-border-soft bg-chip px-1.5 text-[11px] font-medium leading-none text-chip-fg"

export const statusToneClass = {
  quiet: "bg-quiet text-quiet-fg",
  running: "bg-running text-running-fg",
  attention: "bg-attention text-attention-fg",
  stale: "bg-stale text-stale-fg"
} as const

export const statusDotClass = {
  idle: "bg-quiet-fg",
  running: "bg-running-dot",
  needs_input: "bg-failed-dot",
  interrupted: "bg-failed-dot",
  failed: "bg-failed-dot",
  completed: "bg-completed-dot",
  stale: "bg-stale-dot"
} as const
