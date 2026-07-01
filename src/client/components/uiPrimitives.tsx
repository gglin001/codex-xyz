import { AnimatePresence, motion } from "framer-motion";
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
	motionPresets,
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
				pressed ? "bg-control text-fg-strong" : null,
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
			{...({ autoComplete: "off" } as Record<string, string>)}
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
			className={cn("flex h-8 items-center gap-2 px-2.5", ui.field, className)}
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

export function ScrollableText({
	className,
	children,
	title,
	mobileStatic = false,
	...props
}: HTMLAttributes<HTMLSpanElement> & { mobileStatic?: boolean }) {
	const fallbackTitle = typeof children === "string" ? children : undefined;
	return (
		<span
			className={cn(
				"scrollable-truncate block min-w-0 max-w-full",
				mobileStatic ? "mobile-static-scroll" : null,
				className,
			)}
			title={title ?? fallbackTitle}
			{...props}
		>
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
				"bg-control px-1.5 py-1 font-mono text-[11px] leading-none text-muted",
				radius.control,
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
				<ScrollableText className="text-[13px] font-medium text-fg">
					{label}
				</ScrollableText>
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
			className={ui.compactIconButton}
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
	bodyPaddingClassName,
	headerButtonPaddingClassName,
	previewClassName,
	previewPaddingClassName,
}: {
	title: string;
	expanded: boolean;
	onToggle: () => void;
	meta?: ReactNode;
	actions?: ReactNode;
	preview?: ReactNode;
	children?: ReactNode;
	size?: "compact" | "regular" | "prominent";
	surface?: "filled" | "outline" | "plain";
	className?: string;
	bodyClassName?: string;
	bodyPaddingClassName?: string;
	headerButtonPaddingClassName?: string;
	previewClassName?: string;
	previewPaddingClassName?: string;
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
	const bodyPadding =
		bodyPaddingClassName ??
		(size === "compact" ? "px-3 pb-3 pt-1" : "px-4 pb-4 pt-1");
	const previewPadding =
		previewPaddingClassName ?? (size === "compact" ? "px-3 pb-2" : "px-4 pb-3");
	const headerButtonPadding =
		headerButtonPaddingClassName ?? (size === "compact" ? "px-3" : "px-4");
	const cardClass =
		surface === "plain"
			? `overflow-hidden ${radius.card} bg-transparent shadow-none`
			: surface === "outline"
				? ui.outlineCard
				: ui.card;
	const headerClass =
		surface === "plain"
			? "group/card-header flex w-full items-center gap-2 bg-transparent transition duration-150 ease-out hover:bg-surface-subtle/40 focus-within:bg-surface-subtle/52"
			: surface === "outline"
				? "group/card-header flex w-full items-center gap-2 bg-transparent transition duration-150 ease-out hover:bg-surface-subtle/60 focus-within:bg-surface-subtle/68"
				: "flex w-full items-center gap-2 bg-surface-subtle/70";
	const headerButtonClass =
		surface === "plain" || surface === "outline"
			? "flex min-w-0 flex-1 items-center gap-3 text-left"
			: "group flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-surface-subtle";

	return (
		<article className={cn(cardClass, className)}>
			<div className={cn(headerClass, headerHeight)}>
				<button
					type="button"
					className={cn(headerButtonClass, headerHeight, headerButtonPadding)}
					aria-expanded={expanded}
					title={expanded ? `Collapse ${title}` : `Expand ${title}`}
					onClick={onToggle}
				>
					<span className="min-w-0 shrink-0 max-w-[70%]">
						<ScrollableText className={cn("block", titleClass)}>
							{title}
						</ScrollableText>
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
							className={ui.compactIconButton}
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
						className={cn("mr-2", ui.compactIconButton)}
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

			<AnimatePresence initial={false}>
				{!expanded && preview ? (
					<motion.div
						key="preview"
						className="overflow-hidden"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={motionPresets.item}
					>
						<div className={cn(previewPadding, previewClassName)}>
							{preview}
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>

			<AnimatePresence initial={false}>
				{expanded && children ? (
					<motion.div
						key="body"
						className="overflow-hidden"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={motionPresets.item}
					>
						<div className={cn("min-w-0", bodyPadding, bodyClassName)}>
							{children}
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
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
				divided ? "bg-control/20" : null,
				ui.row,
				className,
			)}
			onClick={onClick}
		>
			<ScrollableText>{children}</ScrollableText>
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
		<section className="w-full min-w-0 px-2.5 py-2">
			<div className={cn(ui.sectionLabel, "mb-2 min-w-0")}>
				<span className="shrink-0">{icon}</span>
				<ScrollableText>{title}</ScrollableText>
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
	hideLabel = false,
	className,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	mono?: boolean;
	layout?: "stacked" | "inline";
	hideLabel?: boolean;
	className?: string;
}) {
	const inline = layout === "inline";

	return (
		<div
			className={cn(
				"flex w-full min-w-0 gap-2 bg-surface-subtle/54",
				inline
					? "min-h-8 items-center px-2.5 py-1.5"
					: hideLabel
						? "min-h-10 items-center px-2.5 py-2"
						: "min-h-12 items-start px-2.5 py-2",
				radius.control,
				className,
			)}
			title={hideLabel ? value : `${label}: ${value}`}
		>
			<span
				className={cn(
					"flex h-5 w-5 shrink-0 items-center justify-center text-muted",
					inline || hideLabel ? null : "mt-0.5",
				)}
			>
				{icon}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 overflow-hidden",
					inline
						? "flex items-center justify-between gap-2"
						: hideLabel
							? "flex items-center"
							: null,
				)}
			>
				<ScrollableText
					mobileStatic={hideLabel}
					className={cn(
						"text-[12px] font-medium text-muted",
						hideLabel ? "sr-only" : inline ? "shrink-0" : "block",
					)}
				>
					{label}
				</ScrollableText>
				<ScrollableText
					className={cn(
						"text-[12px] text-fg",
						inline ? "min-w-0 text-right" : "block max-w-full",
						mono ? "font-mono" : "font-medium",
					)}
				>
					{value}
				</ScrollableText>
			</span>
		</div>
	);
});

export function SwitchControl({ checked }: { checked: boolean }) {
	return (
		<span
			className={cn(
				"relative h-6 w-10 shrink-0 rounded-full transition duration-150 ease-out",
				checked ? "bg-accent" : "bg-control",
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
