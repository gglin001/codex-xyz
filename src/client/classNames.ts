export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export const iconButtonClass =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border border-white/10 bg-[#2d2d2d] text-neutral-300 shadow-control transition duration-150 ease-out hover:bg-[#393939] hover:text-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"

export const pillClass =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full border border-white/10 bg-[#2d2d2d] px-2 text-[11px] font-medium leading-none text-neutral-300"
