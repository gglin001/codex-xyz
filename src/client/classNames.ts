export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const iconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent text-slate-400 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]"

export const pillClass =
  "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-800/80 bg-slate-900/65 px-1.5 text-[11px] font-medium leading-none text-slate-400"
