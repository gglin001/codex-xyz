export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const iconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent text-fg-strong transition duration-150 ease-fluid hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px"

export const subtleIconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-muted-strong transition duration-150 ease-fluid hover:border-border hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px"

export const activeIconButtonClass =
  "border-border bg-control-hover text-fg-strong shadow-control"

export const pillClass =
  "inline-flex h-5 shrink-0 items-center justify-center rounded-full border border-border-soft bg-chip px-2 text-[11px] font-medium leading-none text-chip-fg"

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
