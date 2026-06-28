import { FolderGit2 } from "lucide-react";
import { memo } from "react";
import { cn } from "../designSystem.js";
import { formatTokens } from "../uiFormat.js";
import { AvatarBadge, ScrollableText } from "./uiPrimitives.js";
import type { WorkbenchProject } from "./workbenchTypes.js";

export function projectResultDetail(project: WorkbenchProject) {
	const parts = [
		project.path,
		`${project.totalThreads} threads`,
		`${formatTokens(project.tokenTotal)} tokens`,
	];
	if (project.runningThreads > 0) {
		parts.push(`${project.runningThreads} running`);
	}
	return parts.join(" / ");
}

export function projectResultTitle(project: WorkbenchProject) {
	return [project.name, project.path, projectResultDetail(project)]
		.filter(Boolean)
		.join("\n");
}

export const ProjectResultRow = memo(function ProjectResultRow({
	project,
	showAvatar = true,
	mobileStaticText = false,
	className,
}: {
	project: WorkbenchProject;
	showAvatar?: boolean;
	mobileStaticText?: boolean;
	className?: string;
}) {
	return (
		<span className={cn("flex min-w-0 flex-1 items-center gap-2.5", className)}>
			{showAvatar ? (
				<AvatarBadge className="h-8 w-8 text-[11px]" aria-hidden="true">
					{project.initials}
				</AvatarBadge>
			) : null}
			<span className="grid min-w-0 flex-1 gap-0.5">
				<span className="flex min-w-0 items-center gap-2">
					<ScrollableText
						className="text-[13px] font-medium leading-5 text-fg-strong"
						mobileStatic={mobileStaticText}
					>
						{project.name}
					</ScrollableText>
					{project.runningThreads > 0 ? (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-running-dot" />
					) : null}
				</span>
				<span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted">
					<FolderGit2 size={12} className="shrink-0" aria-hidden="true" />
					<ScrollableText className="font-mono" mobileStatic={mobileStaticText}>
						{project.path}
					</ScrollableText>
				</span>
				<ScrollableText
					className="text-[11px] leading-4 text-muted"
					mobileStatic={mobileStaticText}
				>
					{project.totalThreads} threads / {formatTokens(project.tokenTotal)}{" "}
					tokens
					{project.runningThreads > 0
						? ` / ${project.runningThreads} running`
						: ""}
				</ScrollableText>
			</span>
		</span>
	);
});
