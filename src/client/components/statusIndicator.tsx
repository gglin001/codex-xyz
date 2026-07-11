import {
	Archive,
	Circle,
	CircleCheck,
	CircleDotDashed,
	CirclePause,
	CircleStop,
	CircleX,
	Loader2,
} from "lucide-react";
import { cn, tone } from "../designSystem.js";
import type { PresentedStatus } from "../statusPresentation.js";
import { statusPresentation, statusTooltip } from "../statusPresentation.js";

const statusToneClass = {
	neutral: {
		dot: "bg-muted-strong",
		icon: "text-muted",
	},
	running: tone.running,
	stale: tone.stale,
	error: tone.error,
	completed: tone.completed,
} as const;

export function statusDotClass(status: PresentedStatus) {
	return statusToneClass[statusPresentation(status).tone].dot;
}

export function StatusIcon({
	status,
	size = 14,
	className,
}: {
	status: PresentedStatus;
	size?: number;
	className?: string;
}) {
	const presentation = statusPresentation(status);
	const iconClass = cn(statusToneClass[presentation.tone].icon, className);

	if (presentation.icon === "running") {
		return <Loader2 size={size} className={cn("animate-spin", iconClass)} />;
	}
	if (presentation.icon === "idle") {
		return <CirclePause size={size} className={iconClass} />;
	}
	if (presentation.icon === "check") {
		return <CircleCheck size={size} className={iconClass} />;
	}
	if (presentation.icon === "stop") {
		return <CircleStop size={size} className={iconClass} />;
	}
	if (presentation.icon === "error") {
		return <CircleX size={size} className={iconClass} />;
	}
	if (presentation.icon === "unloaded") {
		return <CircleDotDashed size={size} className={iconClass} />;
	}
	if (presentation.icon === "archive") {
		return <Archive size={size} className={iconClass} />;
	}
	return <Circle size={size} className={iconClass} />;
}

export function StatusIndicator({
	status,
	title = statusTooltip(status),
	showLabel = true,
	className,
}: {
	status: PresentedStatus;
	title?: string;
	showLabel?: boolean;
	className?: string;
}) {
	const presentation = statusPresentation(status);
	return (
		<span
			className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
			title={title}
		>
			<StatusIcon status={status} />
			{showLabel ? <span>{presentation.label}</span> : null}
		</span>
	);
}
