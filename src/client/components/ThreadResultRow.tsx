import { Bot, Star } from "lucide-react";
import { memo } from "react";
import { cn } from "../designSystem.js";
import {
	statusPresentation,
	threadStatusTooltip,
} from "../statusPresentation.js";
import {
	type DateTimeFormatMode,
	formatFullDateTime,
	formatTokens,
} from "../uiFormat.js";
import { StatusIcon } from "./statusIndicator.js";
import { ScrollableText } from "./uiPrimitives.js";
import type { WorkbenchThread } from "./workbenchTypes.js";

function threadDetailParts(
	thread: WorkbenchThread,
	projectName?: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	return [
		`${formatTokens(thread.tokensUsed)} tk`,
		statusPresentation(thread.status).label,
		formatFullDateTime(thread.updatedAt, dateTimeFormatMode),
		projectName,
	].filter(Boolean);
}

export function threadAgentLabel(thread: WorkbenchThread) {
	if (
		thread.sourceKind !== "subagent" &&
		!thread.agentNickname &&
		!thread.agentRole
	) {
		return null;
	}
	return ["Agent", thread.agentNickname, thread.agentRole]
		.filter(Boolean)
		.join(" / ");
}

export function threadResultTitle(
	thread: WorkbenchThread,
	projectName?: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	return [
		thread.name,
		threadAgentLabel(thread),
		threadDetailParts(thread, projectName, dateTimeFormatMode).join(" / "),
		thread.preview,
		thread.cwd,
	]
		.filter(Boolean)
		.join("\n");
}

export function threadResultSearchText(
	thread: WorkbenchThread,
	projectName?: string,
	dateTimeFormatMode: DateTimeFormatMode = "utc",
) {
	return [
		thread.name,
		threadAgentLabel(thread),
		thread.sourceKind === "subagent" ? "subagent sub-agent" : "",
		thread.preview,
		thread.cwd,
		projectName ?? "",
		thread.model ?? "",
		thread.status,
		statusPresentation(thread.status).label,
		thread.runtimeStatus,
		statusPresentation(thread.runtimeStatus).label,
		thread.lastTurnStatus ?? "",
		thread.lastTurnStatus
			? statusPresentation(thread.lastTurnStatus).label
			: "",
		thread.archivedAt ? "archive archived" : "",
		formatFullDateTime(thread.updatedAt, dateTimeFormatMode),
		formatTokens(thread.tokensUsed),
	]
		.filter(Boolean)
		.join(" / ");
}

function ThreadTagScoreStack({
	score,
}: {
	score: WorkbenchThread["tagScore"];
}) {
	if (!score) {
		return null;
	}
	const values = [3, 2, 1] as const;
	return (
		<span
			className="flex h-8 w-4 shrink-0 flex-col-reverse items-center justify-start gap-[1px] text-accent"
			aria-label={`${score} star thread score`}
			role="img"
			title={`${score} star thread score`}
		>
			{values.map((value) =>
				value <= score ? (
					<Star
						key={value}
						size={9}
						fill="currentColor"
						strokeWidth={2.2}
						aria-hidden="true"
					/>
				) : null,
			)}
		</span>
	);
}

export const ThreadResultRow = memo(function ThreadResultRow({
	thread,
	projectName,
	showStatusIcon = true,
	mobileStaticText = false,
	dateTimeFormatMode = "utc",
	className,
}: {
	thread: WorkbenchThread;
	projectName?: string;
	showStatusIcon?: boolean;
	mobileStaticText?: boolean;
	dateTimeFormatMode?: DateTimeFormatMode;
	className?: string;
}) {
	const detailParts = threadDetailParts(
		thread,
		projectName,
		dateTimeFormatMode,
	);
	const statusTitle = threadStatusTooltip(thread.status, thread.lastTurnStatus);
	const agentLabel = threadAgentLabel(thread);
	return (
		<span className={cn("flex min-w-0 flex-1 items-start gap-2", className)}>
			{showStatusIcon ? (
				<span className="flex h-14 w-4 shrink-0 flex-col items-center gap-0.5">
					<span
						className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center"
						title={statusTitle}
						aria-label={statusTitle}
						role="img"
					>
						<StatusIcon status={thread.status} />
					</span>
					<ThreadTagScoreStack score={thread.tagScore} />
				</span>
			) : null}
			<span className="grid min-w-0 flex-1 gap-0.5">
				<span className="flex min-w-0 items-center gap-2">
					{agentLabel ? (
						<span
							className="flex shrink-0 items-center gap-1 rounded border border-accent/25 bg-accent/10 px-1.5 text-[10px] font-semibold leading-[18px] text-accent"
							title={agentLabel}
						>
							<Bot size={11} aria-hidden="true" />
							<span>{thread.agentNickname || "Agent"}</span>
						</span>
					) : null}
					<ScrollableText
						className="text-[13px] font-medium leading-5"
						mobileStatic={mobileStaticText}
					>
						{thread.name}
					</ScrollableText>
				</span>
				{thread.agentRole ? (
					<ScrollableText
						className="text-[11px] leading-4 text-accent/80"
						mobileStatic={mobileStaticText}
					>
						{thread.agentRole}
					</ScrollableText>
				) : null}
				<span
					className={cn(
						"scrollable-row flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted",
						mobileStaticText ? "mobile-static-scroll" : null,
					)}
				>
					{detailParts.map((part) => (
						<span key={part} className="shrink-0">
							{part}
						</span>
					))}
				</span>
				<ScrollableText
					className="text-[11px] leading-[18px] text-muted-strong"
					mobileStatic={mobileStaticText}
				>
					{thread.preview}
				</ScrollableText>
			</span>
		</span>
	);
});
