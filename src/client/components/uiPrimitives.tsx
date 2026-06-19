import { ChevronDown } from "lucide-react"
import type { ButtonHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react"
import { memo } from "react"
import { cn, radius, ui } from "../designSystem.js"

export function IconButton({
  className,
  children,
  pressed = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.iconButton, pressed ? "bg-control-hover text-fg-strong" : null, className)}
      aria-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  )
}

export function LargeIconButton({
  className,
  children,
  pressed = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.largeIconButton, pressed ? "bg-control-hover text-fg-strong" : null, className)}
      aria-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  )
}

export function ComposerIconButton({
  className,
  children,
  pressed = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.composerIconButton, pressed ? ui.selectedStrong : null, className)}
      aria-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  )
}

export function ControlButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(ui.buttonControl, className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function ControlCard({
  children,
  className,
  size = "regular"
}: {
  children: ReactNode
  className?: string
  size?: "regular" | "large" | "panel"
}) {
  const cardClass = size === "panel" ? ui.panelCard : size === "large" ? ui.cardLarge : ui.card
  return (
    <div className={cn(cardClass, className)}>
      {children}
    </div>
  )
}

export function SurfaceAction({
  className,
  children,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.surfaceButton, selected ? ui.selected : "text-fg", className)}
      aria-pressed={selected ?? undefined}
      {...props}
    >
      {children}
    </button>
  )
}

export function NavAction({
  className,
  children,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.navButton, selected ? ui.navSelected : "text-muted-strong", className)}
      aria-pressed={selected ?? undefined}
      {...props}
    >
      {children}
    </button>
  )
}

export function MenuItemButton({
  className,
  children,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.menuItem, selected ? ui.selected : "text-fg", className)}
      aria-pressed={selected ?? undefined}
      {...props}
    >
      {children}
    </button>
  )
}

export function FieldShell({
  icon,
  children,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <label className={cn("flex h-12 items-center gap-3 px-3.5", ui.field, className)} {...props}>
      {icon ? <span className="flex shrink-0 items-center justify-center">{icon}</span> : null}
      {children}
    </label>
  )
}

export function AvatarBadge({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center", ui.avatar, className)} {...props}>
      {children}
    </span>
  )
}

export function Pill({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn(ui.pill, className)} {...props}>
      {children}
    </span>
  )
}

export function Keycap({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("rounded-full border border-border bg-control px-2 py-1 font-mono text-[10px] leading-none text-muted", className)}
      {...props}
    >
      {children}
    </span>
  )
}

export function SegmentedControl({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(ui.segmented, className)}>
      {children}
    </div>
  )
}

export function SegmentButton({
  className,
  children,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(ui.segment, selected ? ui.selected : "text-muted", className)}
      aria-pressed={selected ?? undefined}
      {...props}
    >
      {children}
    </button>
  )
}

export const CopyIconButton = memo(function CopyIconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:bg-control hover:text-fg-strong", radius.control, ui.row)}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
})

export const CollapsibleCard = memo(function CollapsibleCard({
  title,
  expanded,
  onToggle,
  meta,
  actions,
  preview,
  children,
  size = "regular",
  className,
  bodyClassName,
  previewClassName
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  meta?: ReactNode
  actions?: ReactNode
  preview?: ReactNode
  children?: ReactNode
  size?: "compact" | "regular" | "prominent"
  className?: string
  bodyClassName?: string
  previewClassName?: string
}) {
  const headerHeight = size === "compact" ? "min-h-8" : size === "prominent" ? "min-h-11" : "min-h-10"
  const titleClass = size === "compact"
    ? "text-[12px] font-medium text-fg"
    : size === "prominent"
      ? "text-[16px] font-semibold text-fg-strong"
      : "text-[14px] font-medium text-fg"
  const bodyPadding = size === "compact" ? "p-3" : "px-4 py-4"
  const previewPadding = size === "compact" ? "px-3 pb-2" : "px-4 py-3"

  return (
    <article className={cn(ui.card, className)}>
      <div className={cn("flex w-full items-center gap-2 border-b border-border bg-control/35", headerHeight)}>
        <button
          type="button"
          className={cn("group flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:bg-control-hover", headerHeight, size === "compact" ? "px-3" : "px-4")}
          aria-expanded={expanded}
          title={expanded ? `Collapse ${title}` : `Expand ${title}`}
          onClick={onToggle}
        >
          <span className="min-w-0">
            <span className={cn("block truncate", titleClass)}>{title}</span>
          </span>
          <ChevronDown
            size={size === "compact" ? 14 : 17}
            className={cn("shrink-0 text-muted transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        {(meta || actions) ? (
          <div className={cn("flex shrink-0 items-center gap-1.5", size === "compact" ? "pr-1.5" : "pr-2")}>
            {meta}
            {actions}
          </div>
        ) : null}
      </div>

      {!expanded && preview ? (
        <div className={cn(previewPadding, previewClassName)}>{preview}</div>
      ) : null}

      {expanded && children ? (
        <div className={cn("min-w-0", bodyPadding, bodyClassName)}>
          {children}
        </div>
      ) : null}
    </article>
  )
})

export function MessageGroup({
  role,
  time,
  children,
  className
}: {
  role: string
  time: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("grid gap-4", className)}>
      <div className="flex items-center gap-3 text-[14px] font-medium text-muted">
        <span>{role}</span>
        <span aria-hidden="true">·</span>
        <span>{time}</span>
      </div>
      {children}
    </section>
  )
}

export function DisclosureRow({
  expanded,
  children,
  onClick,
  className
}: {
  expanded?: boolean
  children: ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn("flex min-h-11 w-full items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-left text-[14px] text-fg", ui.row, className)}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown size={16} className={cn("shrink-0 text-muted-strong", expanded ? "rotate-180" : null)} />
    </button>
  )
}

export function SettingsSection({
  icon,
  title,
  children
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-border px-5 py-6 last:border-b-0">
      <div className={cn(ui.sectionLabel, "mb-4")}>
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

export const InfoTile = memo(function InfoTile({
  icon,
  label,
  value,
  mono = false,
  className
}: {
  icon: ReactNode
  label: string
  value: string
  mono?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex items-start gap-3 border border-border bg-detail px-3 py-3", radius.controlLg, className)}>
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase text-muted">{label}</span>
        <span className={cn("block truncate text-[13px] text-fg", mono ? "font-mono" : "font-medium")}>{value}</span>
      </span>
    </div>
  )
})

export function SwitchControl({
  checked
}: {
  checked: boolean
}) {
  return (
    <span
      className={cn(
        "relative h-8 w-14 shrink-0 rounded-full border border-border transition duration-150 ease-out",
        checked ? "bg-neutral-100" : "bg-control"
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute top-1 h-6 w-6 rounded-full transition duration-150 ease-out",
          checked ? "left-7 bg-app-bg" : "left-1 bg-muted"
        )}
      />
    </span>
  )
}
