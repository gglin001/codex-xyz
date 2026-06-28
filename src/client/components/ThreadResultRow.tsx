import { Star } from "lucide-react";
import { memo } from "react";
import { cn } from "../designSystem.js";
import { formatFullDateTime, formatTokens, statusLabel } from "../uiFormat.js";
import { ThreadStatusIcon, threadStatusDotClass } from "./threadStatusIcon.js";
import { ScrollableText } from "./uiPrimitives.js";
import type { WorkbenchThread } from "./workbenchTypes.js";

function threadDetailParts(thread: WorkbenchThread, projectName?: string) {
	return [
		`${formatTokens(thread.tokensUsed)} tk`,
		statusLabel(thread.status),
		formatFullDateTime(thread.updatedAt),
		projectName,
	].filter(Boolean);
}

export function threadResultTitle(
	thread: WorkbenchThread,
	projectName?: string,
) {
	return [
		thread.name,
		threadDetailParts(thread, projectName).join(" / "),
		thread.preview,
		thread.cwd,
	]
		.filter(Boolean)
		.join("\n");
}

export function threadResultSearchText(
	thread: WorkbenchThread,
	projectName?: string,
) {
	return [
		thread.name,
		thread.preview,
		thread.cwd,
		projectName ?? "",
		thread.model ?? "",
		thread.status,
		statusLabel(thread.status),
		thread.runtimeStatus,
		statusLabel(thread.runtimeStatus),
		thread.lastTurnStatus ?? "",
		thread.lastTurnStatus ? statusLabel(thread.lastTurnStatus) : "",
		thread.archivedAt ? "archive archived" : "",
		formatFullDateTime(thread.updatedAt),
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
	className,
}: {
	thread: WorkbenchThread;
	projectName?: string;
	showStatusIcon?: boolean;
	mobileStaticText?: boolean;
	className?: string;
}) {
	const detailParts = threadDetailParts(thread, projectName);
	return (
		<span className={cn("flex min-w-0 flex-1 items-start gap-2", className)}>
			{showStatusIcon ? (
				<span className="flex h-14 w-4 shrink-0 flex-col items-center gap-0.5">
					<span
						className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center"
						aria-hidden="true"
					>
						<ThreadStatusIcon status={thread.status} />
					</span>
					<ThreadTagScoreStack score={thread.tagScore} />
				</span>
			) : null}
			<span className="grid min-w-0 flex-1 gap-0.5">
				<span className="flex min-w-0 items-center gap-2">
					<ScrollableText
						className="text-[13px] font-medium leading-5"
						mobileStatic={mobileStaticText}
					>
						{thread.name}
					</ScrollableText>
					<span
						className={cn(
							"h-1.5 w-1.5 shrink-0 rounded-full",
							threadStatusDotClass[thread.status],
						)}
					/>
				</span>
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
