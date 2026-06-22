import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { codexThreadCommandLabels } from "../codexCommandLabels.js";
import { cn, ui } from "../designSystem.js";
import { formatFullDateTime, formatTokens, statusLabel } from "../uiFormat.js";
import {
	SessionStatusIcon,
	sessionStatusDotClass,
} from "./sessionStatusIcon.js";
import {
	AvatarBadge,
	ControlButton,
	ControlCard,
	FieldShell,
	MenuItemButton,
	NavAction,
	SurfaceAction,
} from "./uiPrimitives.js";
import type {
	DateBucket,
	WorkbenchProject,
	WorkbenchSession,
} from "./workbenchTypes.js";

export type SidebarProps = {
	className?: string;
	projects: WorkbenchProject[];
	selectedProjectId: string;
	selectedSessionId: string | null;
	sessionQuery: string;
	onProjectChange: (projectId: string) => void;
	onSessionQueryChange: (value: string) => void;
	onSelectSession: (session: WorkbenchSession) => void;
	onCreateSession: () => void;
	footer?: ReactNode;
};

const bucketOrder: DateBucket[] = ["Today", "Yesterday", "Older"];

function projectTitle(project: WorkbenchProject) {
	const parts = [
		project.path,
		`${project.totalSessions} sessions`,
		`${formatTokens(project.tokenTotal)} tokens`,
	];
	if (project.runningSessions > 0) {
		parts.push(`${project.runningSessions} running`);
	}
	return parts.join("\n");
}

function filterSessions(project: WorkbenchProject, query: string) {
	const queryTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (queryTokens.length === 0) {
		return project.sessions;
	}
	return project.sessions.filter((session) => {
		const fields = [
			session.title,
			session.preview,
			session.cwd,
			session.model ?? "",
			session.status,
			statusLabel(session.status),
			session.runtimeStatus,
			statusLabel(session.runtimeStatus),
			session.lastTurnStatus ?? "",
			session.lastTurnStatus ? statusLabel(session.lastTurnStatus) : "",
			session.archivedAt ? "archive archived" : "",
		].map((field) => field.toLowerCase());
		return queryTokens.every((token) =>
			fields.some((field) => field.includes(token)),
		);
	});
}

function groupSessions(sessions: WorkbenchSession[]) {
	const grouped = new Map<DateBucket, WorkbenchSession[]>();
	for (const bucket of bucketOrder) {
		grouped.set(bucket, []);
	}
	for (const session of sessions) {
		grouped.get(session.dateBucket)?.push(session);
	}
	return bucketOrder
		.map((bucket) => ({
			bucket,
			sessions: grouped.get(bucket) ?? [],
		}))
		.filter((group) => group.sessions.length > 0);
}

export const Sidebar = memo(function Sidebar({
	className,
	projects,
	selectedProjectId,
	selectedSessionId,
	sessionQuery,
	onProjectChange,
	onSessionQueryChange,
	onSelectSession,
	onCreateSession,
	footer,
}: SidebarProps) {
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const selectedProject =
		projects.find((project) => project.id === selectedProjectId) ?? projects[0];
	const visibleSessions = useMemo(
		() =>
			selectedProject ? filterSessions(selectedProject, sessionQuery) : [],
		[selectedProject, sessionQuery],
	);
	const sessionGroups = useMemo(
		() => groupSessions(visibleSessions),
		[visibleSessions],
	);

	return (
		<aside
			className={cn(
				"flex h-full min-h-0 flex-col border-r border-r-border-strong",
				ui.sidePanel,
				className,
			)}
		>
			<div className="relative shrink-0 p-3 pb-2">
				<SurfaceAction
					className="h-11 w-full gap-2.5 px-2.5"
					title={
						selectedProject ? projectTitle(selectedProject) : "Switch project"
					}
					aria-haspopup="menu"
					aria-expanded={projectMenuOpen}
					onClick={() => setProjectMenuOpen((current) => !current)}
				>
					<AvatarBadge className="h-7 w-7 text-[11px]" aria-hidden="true">
						{selectedProject?.initials ?? "CX"}
					</AvatarBadge>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[14px] font-semibold text-fg-strong">
							{selectedProject?.name ?? "Project"}
						</span>
						<span className="block truncate text-[11px] text-muted">
							{selectedProject?.path ?? "No project selected"}
						</span>
					</span>
					<ChevronDown size={15} className="shrink-0 text-muted" />
				</SurfaceAction>

				<AnimatePresence>
					{projectMenuOpen ? (
						<motion.div
							className={cn(
								"absolute left-3 right-3 top-[58px] z-30 p-1.5",
								ui.popover,
							)}
							initial={{ opacity: 0, y: -8, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -8, scale: 0.98 }}
							transition={{ type: "spring", stiffness: 420, damping: 32 }}
							role="menu"
						>
							{projects.map((project) => (
								<MenuItemButton
									key={project.id}
									className="h-10 w-full gap-2.5 px-2.5"
									role="menuitem"
									selected={project.id === selectedProjectId}
									onClick={() => {
										onProjectChange(project.id);
										setProjectMenuOpen(false);
									}}
								>
									<AvatarBadge className="h-7 w-7 text-[11px]">
										{project.initials}
									</AvatarBadge>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px] font-medium text-fg-strong">
											{project.name}
										</span>
										<span className="block truncate text-[11px] text-muted">
											{project.totalSessions} sessions /{" "}
											{formatTokens(project.tokenTotal)} tokens
										</span>
									</span>
									{project.id === selectedProjectId ? (
										<Check size={14} className="text-fg-strong" />
									) : null}
								</MenuItemButton>
							))}
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>

			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-3 pt-2">
				<div className="min-w-0 flex-1">
					<FieldShell icon={<Search size={14} />} className="h-9 w-full">
						<input
							className={cn(ui.input, "text-[13px]")}
							value={sessionQuery}
							onChange={(event) => onSessionQueryChange(event.target.value)}
							placeholder="Search sessions"
							aria-label="Search sessions"
						/>
					</FieldShell>
				</div>
				<ControlButton
					className="h-9 w-9 shrink-0 bg-transparent"
					onClick={onCreateSession}
					title={codexThreadCommandLabels.new}
					aria-label={codexThreadCommandLabels.new}
				>
					<Plus size={16} />
				</ControlButton>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scroll-mask-y">
				<AnimatePresence mode="popLayout">
					<motion.div
						key={selectedProject?.id ?? "empty"}
						initial={{ opacity: 0, x: -10 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 10 }}
						transition={{ type: "spring", stiffness: 360, damping: 34 }}
						className="grid gap-5"
					>
						{sessionGroups.length === 0 ? (
							<ControlCard className="border-dashed bg-transparent px-3 py-7 text-center text-[12px] text-muted">
								{sessionQuery.trim()
									? "No matching sessions"
									: "No Codex sessions yet"}
							</ControlCard>
						) : null}
						{sessionGroups.map((group) => (
							<section key={group.bucket} className="grid gap-1">
								<div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-normal text-muted-strong">
									{group.bucket}
								</div>
								{group.sessions.map((session) => {
									const selected =
										selectedSessionId === session.id ||
										selectedSessionId === session.threadId;
									return (
										<NavAction
											key={session.id}
											className={cn(
												"group w-full items-start gap-2 px-2.5 py-2",
												selected ? null : "bg-transparent",
											)}
											selected={selected}
											title={`${session.title}\n${statusLabel(session.status)}\n${formatFullDateTime(session.updatedAt)}\n${session.preview}`}
											onClick={() => onSelectSession(session)}
										>
											<span
												className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center"
												aria-hidden="true"
											>
												<SessionStatusIcon status={session.status} />
											</span>
											<span className="grid min-w-0 flex-1 grid-rows-[19px_15px_18px]">
												<span className="flex min-w-0 items-center gap-2">
													<span className="truncate text-[13px] font-medium leading-5">
														{session.title}
													</span>
													<span
														className={cn(
															"h-1.5 w-1.5 shrink-0 rounded-full",
															sessionStatusDotClass[session.status],
														)}
													/>
												</span>
												<span className="truncate text-[11px] leading-4 text-muted">
													{formatFullDateTime(session.updatedAt)} /{" "}
													{formatTokens(session.tokensUsed)} tokens /{" "}
													{statusLabel(session.status)}
												</span>
												<span className="truncate text-[11px] leading-[18px] text-muted-strong">
													{session.preview}
												</span>
											</span>
										</NavAction>
									);
								})}
							</section>
						))}
					</motion.div>
				</AnimatePresence>
			</div>

			{footer}
		</aside>
	);
});
