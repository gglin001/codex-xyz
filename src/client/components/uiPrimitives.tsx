import { ChevronDown } from "lucide-react";
import type {
	ButtonHTMLAttributes,
	HTMLAttributes,
	MouseEvent,
	ReactNode,
} from "react";
import { memo, useMemo } from "react";
import {
	cn,
	displayScale,
	formatDisplayScale,
	radius,
	ui,
} from "../designSystem.js";

export function IconButton({
	className,
	children,
	pressed = false,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	pressed?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.iconButton,
				pressed ? "bg-control-hover text-fg-strong" : null,
				className,
			)}
			aria-pressed={pressed}
			{...props}
		>
			{children}
		</button>
	);
}

export function LargeIconButton({
	className,
	children,
	pressed = false,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	pressed?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.largeIconButton,
				pressed ? "border-border bg-control text-fg-strong" : null,
				className,
			)}
			aria-pressed={pressed}
			{...props}
		>
			{children}
		</button>
	);
}

export function ComposerIconButton({
	className,
	children,
	pressed = false,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	pressed?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.composerIconButton,
				pressed ? ui.selectedStrong : null,
				className,
			)}
			aria-pressed={pressed}
			{...props}
		>
			{children}
		</button>
	);
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
	);
}

export function ControlCard({
	children,
	className,
	size = "regular",
}: {
	children: ReactNode;
	className?: string;
	size?: "regular" | "large" | "panel";
}) {
	const cardClass =
		size === "panel" ? ui.panelCard : size === "large" ? ui.cardLarge : ui.card;
	return <div className={cn(cardClass, className)}>{children}</div>;
}

export function SurfaceAction({
	className,
	children,
	selected,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	selected?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.surfaceButton,
				selected ? ui.selected : "text-fg",
				className,
			)}
			aria-pressed={selected ?? undefined}
			{...props}
		>
			{children}
		</button>
	);
}

export function NavAction({
	className,
	children,
	selected,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	selected?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.navButton,
				selected ? ui.navSelected : "text-muted-strong",
				className,
			)}
			aria-pressed={selected ?? undefined}
			{...props}
		>
			{children}
		</button>
	);
}

export function MenuItemButton({
	className,
	children,
	selected,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	selected?: boolean;
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
	);
}

export function FieldShell({
	icon,
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement> & {
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			className={cn("flex h-11 items-center gap-2.5 px-3", ui.field, className)}
			{...props}
		>
			{icon ? (
				<span className="flex shrink-0 items-center justify-center">
					{icon}
				</span>
			) : null}
			{children}
		</div>
	);
}

export function AvatarBadge({
	children,
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center",
				ui.avatar,
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
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
	);
}

export function Keycap({
	className,
	children,
	...props
}: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn(
				"rounded-[6px] border border-border bg-control px-1.5 py-1 font-mono text-[11px] leading-none text-muted",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

export function SegmentedControl({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn(ui.segmented, className)}>{children}</div>;
}

export function SegmentButton({
	className,
	children,
	selected,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	selected?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				ui.segment,
				selected ? ui.selected : "text-muted",
				className,
			)}
			aria-pressed={selected ?? undefined}
			{...props}
		>
			{children}
		</button>
	);
}

export function ScaleControl({
	label,
	value,
	onChange,
	min = displayScale.min,
	max = displayScale.max,
	step = displayScale.step,
	className,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	className?: string;
}) {
	const tickValues = useMemo(
		() =>
			Array.from(
				{ length: Math.round((max - min) / step) + 1 },
				(_item, index) => min + index * step,
			),
		[max, min, step],
	);

	return (
		<div className={cn("w-full min-w-0", className)}>
			<div className="mb-2 flex items-center justify-between gap-3">
				<span className="truncate text-[13px] font-medium text-fg">
					{label}
				</span>
				<span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-strong">
					{formatDisplayScale(value)}
				</span>
			</div>
			<div className="relative">
				<input
					type="range"
					min={min}
					max={max}
					step={step}
					value={value}
					onChange={(event) => onChange(Number(event.target.value))}
					className={ui.range}
					aria-label={label}
				/>
				<div className="pointer-events-none absolute inset-x-[5px] top-1/2 flex -translate-y-1/2 justify-between">
					{tickValues.map((tickValue) => (
						<span
							key={tickValue}
							className={cn(
								"h-1.5 w-1.5 rounded-full",
								Math.abs(tickValue - value) < step / 2
									? "bg-fg-strong"
									: "bg-muted-strong",
							)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

export const CopyIconButton = memo(function CopyIconButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className={cn(
				"inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:bg-control hover:text-fg-strong",
				radius.control,
				ui.row,
			)}
			title={label}
			aria-label={label}
			onClick={onClick}
		>
			{children}
		</button>
	);
});

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
	previewClassName,
}: {
	title: string;
	expanded: boolean;
	onToggle: () => void;
	meta?: ReactNode;
	actions?: ReactNode;
	preview?: ReactNode;
	children?: ReactNode;
	size?: "compact" | "regular" | "prominent";
	surface?: "filled" | "outline";
	className?: string;
	bodyClassName?: string;
	previewClassName?: string;
}) {
	const headerHeight =
		size === "compact"
			? "min-h-8"
			: size === "prominent"
				? "min-h-10"
				: "min-h-9";
	const titleClass =
		size === "compact"
			? "text-[12px] font-medium text-fg"
			: size === "prominent"
				? "text-[14px] font-semibold text-fg-strong"
				: "text-[13px] font-medium text-fg";
	const bodyPadding = size === "compact" ? "px-3 pb-3 pt-1" : "px-4 pb-4 pt-1";
	const previewPadding = size === "compact" ? "px-3 pb-2" : "px-4 pb-3";
	const cardClass = surface === "outline" ? ui.outlineCard : ui.card;
	const headerClass =
		surface === "outline"
			? "group/card-header flex w-full items-center gap-2 bg-transparent transition duration-150 ease-out hover:bg-control/40 focus-within:bg-control/40"
			: "flex w-full items-center gap-2 border-b border-border bg-control/35";
	const headerButtonClass =
		surface === "outline"
			? "flex min-w-0 flex-1 items-center gap-3 text-left"
			: "group flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-control-hover";

	return (
		<article className={cn(cardClass, className)}>
			<div className={cn(headerClass, headerHeight)}>
				<button
					type="button"
					className={cn(
						headerButtonClass,
						headerHeight,
						size === "compact" ? "px-3" : "px-4",
					)}
					aria-expanded={expanded}
					title={expanded ? `Collapse ${title}` : `Expand ${title}`}
					onClick={onToggle}
				>
					<span className="min-w-0 shrink-0 max-w-[70%]">
						<span className={cn("block truncate", titleClass)}>{title}</span>
					</span>
					{meta ? <span className="min-w-0 flex-1">{meta}</span> : null}
				</button>
				{meta || actions ? (
					<div
						className={cn(
							"flex shrink-0 items-center gap-1.5",
							size === "compact" ? "pr-1.5" : "pr-2",
						)}
					>
						<button
							type="button"
							className={cn(
								"inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted transition duration-150 ease-out hover:bg-control hover:text-fg-strong",
								radius.control,
							)}
							aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
							aria-expanded={expanded}
							title={expanded ? `Collapse ${title}` : `Expand ${title}`}
							onClick={onToggle}
						>
							<ChevronDown
								size={size === "compact" ? 13 : 15}
								className={cn(
									"shrink-0 transition-transform duration-150 ease-out",
									expanded ? "rotate-180" : null,
								)}
							/>
						</button>
						{actions}
					</div>
				) : (
					<button
						type="button"
						className={cn(
							"mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted transition duration-150 ease-out hover:bg-control hover:text-fg-strong",
							radius.control,
						)}
						aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
						aria-expanded={expanded}
						title={expanded ? `Collapse ${title}` : `Expand ${title}`}
						onClick={onToggle}
					>
						<ChevronDown
							size={size === "compact" ? 13 : 15}
							className={cn(
								"shrink-0 transition-transform duration-150 ease-out",
								expanded ? "rotate-180" : null,
							)}
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
	);
});

export function DisclosureRow({
	expanded,
	children,
	onClick,
	className,
	divided = true,
}: {
	expanded?: boolean;
	children: ReactNode;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	className?: string;
	divided?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] text-fg",
				divided ? "border-t border-border" : null,
				ui.row,
				className,
			)}
			onClick={onClick}
		>
			<span className="min-w-0 truncate">{children}</span>
			<ChevronDown
				size={15}
				className={cn(
					"shrink-0 text-muted-strong",
					expanded ? "rotate-180" : null,
				)}
			/>
		</button>
	);
}

export function SettingsSection({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="w-full min-w-0 border-b border-border px-4 py-4 last:border-b-0">
			<div className={cn(ui.sectionLabel, "mb-3 min-w-0")}>
				<span className="shrink-0">{icon}</span>
				<span className="truncate">{title}</span>
			</div>
			{children}
		</section>
	);
}

export const InfoTile = memo(function InfoTile({
	icon,
	label,
	value,
	mono = false,
	layout = "stacked",
	className,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	mono?: boolean;
	layout?: "stacked" | "inline";
	className?: string;
}) {
	const inline = layout === "inline";

	return (
		<div
			className={cn(
				"flex w-full min-w-0 gap-2.5 border border-border bg-field/70",
				inline
					? "min-h-9 items-center px-2.5 py-2"
					: "min-h-[56px] items-start px-3 py-2.5",
				radius.control,
				className,
			)}
			title={`${label}: ${value}`}
		>
			<span
				className={cn(
					"flex h-5 w-5 shrink-0 items-center justify-center text-muted",
					inline ? null : "mt-0.5",
				)}
			>
				{icon}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1",
					inline ? "flex items-center justify-between gap-2" : null,
				)}
			>
				<span
					className={cn(
						"truncate text-[11px] font-medium uppercase text-muted-strong",
						inline ? "shrink-0" : "block",
					)}
				>
					{label}
				</span>
				<span
					className={cn(
						"truncate text-[12px] text-fg",
						inline ? "min-w-0 text-right" : "block max-w-full",
						mono ? "font-mono" : "font-medium",
					)}
				>
					{value}
				</span>
			</span>
		</div>
	);
});

export function SwitchControl({ checked }: { checked: boolean }) {
	return (
		<span
			className={cn(
				"relative h-6 w-10 shrink-0 rounded-full border border-border transition duration-150 ease-out",
				checked ? "border-accent-soft bg-accent" : "bg-control",
			)}
			aria-hidden="true"
		>
			<span
				className={cn(
					"absolute top-1 h-4 w-4 rounded-full transition duration-150 ease-out",
					checked ? "left-5 bg-accent-fg" : "left-1 bg-muted",
				)}
			/>
		</span>
	);
}
