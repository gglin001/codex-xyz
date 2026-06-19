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
    <label className={cn("flex h-11 items-center gap-2.5 px-3", ui.field, className)} {...props}>
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
      className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:bg-control hover:text-fg-strong", radius.control, ui.row)}
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
  surface = "outline",
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
  surface?: "filled" | "outline"
  className?: string
  bodyClassName?: string
  previewClassName?: string
}) {
  const headerHeight = size === "compact" ? "min-h-8" : size === "prominent" ? "min-h-10" : "min-h-9"
  const titleClass = size === "compact"
    ? "text-[12px] font-medium text-fg"
    : size === "prominent"
      ? "text-[14px] font-semibold text-fg-strong"
      : "text-[13px] font-medium text-fg"
  const bodyPadding = size === "compact" ? "p-3" : "px-4 py-4"
  const previewPadding = size === "compact" ? "px-3 pb-2" : "px-4 pb-3 pt-2"
  const cardClass = surface === "outline" ? ui.outlineCard : ui.card
  const headerClass = surface === "outline"
    ? "group/card-header flex w-full items-center gap-2 bg-app-bg transition duration-150 ease-out hover:bg-control/35 focus-within:bg-control/35"
    : "flex w-full items-center gap-2 border-b border-border bg-control/35"
  const headerButtonClass = surface === "outline"
    ? "flex min-w-0 flex-1 items-center gap-3 text-left"
    : "group flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:bg-control-hover"

  return (
    <article className={cn(cardClass, className)}>
      <div className={cn(headerClass, headerHeight)}>
        <button
          type="button"
          className={cn(headerButtonClass, headerHeight, size === "compact" ? "px-3" : "px-4")}
          aria-expanded={expanded}
          title={expanded ? `Collapse ${title}` : `Expand ${title}`}
          onClick={onToggle}
        >
          <span className="min-w-0">
            <span className={cn("block truncate", titleClass)}>{title}</span>
          </span>
        </button>
        {(meta || actions) ? (
          <div className={cn("flex shrink-0 items-center gap-1.5", size === "compact" ? "pr-1.5" : "pr-2")}>
            {meta}
            <button
              type="button"
              className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted transition duration-150 ease-out hover:text-fg-strong", radius.control)}
              aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
              aria-expanded={expanded}
              title={expanded ? `Collapse ${title}` : `Expand ${title}`}
              onClick={onToggle}
            >
              <ChevronDown
                size={size === "compact" ? 13 : 15}
                className={cn("shrink-0 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
              />
            </button>
            {actions}
          </div>
        ) : (
          <button
            type="button"
            className={cn("mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted transition duration-150 ease-out hover:text-fg-strong", radius.control)}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={expanded}
            title={expanded ? `Collapse ${title}` : `Expand ${title}`}
            onClick={onToggle}
          >
            <ChevronDown
              size={size === "compact" ? 13 : 15}
              className={cn("shrink-0 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
            />
          </button>
        )}
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

export function DisclosureRow({
  expanded,
  children,
  onClick,
  className,
  divided = true
}: {
  expanded?: boolean
  children: ReactNode
  onClick: () => void
  className?: string
  divided?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] text-fg",
        divided ? "border-t border-border" : null,
        ui.row,
        className
      )}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown size={15} className={cn("shrink-0 text-muted-strong", expanded ? "rotate-180" : null)} />
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
    <section className="border-b border-border px-5 py-5 last:border-b-0">
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
    <div className={cn("flex items-start gap-2.5 border border-border bg-detail px-3 py-2.5", radius.controlLg, className)}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium uppercase text-muted">{label}</span>
        <span className={cn("block truncate text-[12px] text-fg", mono ? "font-mono" : "font-medium")}>{value}</span>
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
        "relative h-7 w-12 shrink-0 rounded-full border border-border transition duration-150 ease-out",
        checked ? "bg-neutral-100" : "bg-control"
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full transition duration-150 ease-out",
          checked ? "left-6 bg-app-bg" : "left-1 bg-muted"
        )}
      />
    </span>
  )
}
