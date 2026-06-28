import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { codexThreadCommandLabels } from "../codexCommandLabels.js";
import { cn, layer, motionPresets, ui } from "../designSystem.js";
import { ProjectResultRow, projectResultTitle } from "./ProjectResultRow.js";
import {
	ThreadResultRow,
	threadResultSearchText,
	threadResultTitle,
} from "./ThreadResultRow.js";
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
	WorkbenchThread,
} from "./workbenchTypes.js";

export type SidebarProps = {
	className?: string;
	projects: WorkbenchProject[];
	selectedProjectId: string;
	selectedThreadKey: string | null;
	threadQuery: string;
	onProjectChange: (projectId: string) => void;
	onThreadQueryChange: (value: string) => void;
	onSelectThread: (thread: WorkbenchThread) => void;
	onCreateThread: () => void;
	footer?: ReactNode;
};

const bucketOrder: DateBucket[] = ["Today", "Yesterday", "Older"];

function filterThreads(project: WorkbenchProject, query: string) {
	const queryTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (queryTokens.length === 0) {
		return project.threads;
	}
	return project.threads.filter((thread) => {
		const fields = [threadResultSearchText(thread)].map((field) =>
			field.toLowerCase(),
		);
		return queryTokens.every((token) =>
			fields.some((field) => field.includes(token)),
		);
	});
}

function groupThreads(threads: WorkbenchThread[]) {
	const grouped = new Map<DateBucket, WorkbenchThread[]>();
	for (const bucket of bucketOrder) {
		grouped.set(bucket, []);
	}
	for (const thread of threads) {
		grouped.get(thread.dateBucket)?.push(thread);
	}
	return bucketOrder
		.map((bucket) => ({
			bucket,
			threads: grouped.get(bucket) ?? [],
		}))
		.filter((group) => group.threads.length > 0);
}

export const Sidebar = memo(function Sidebar({
	className,
	projects,
	selectedProjectId,
	selectedThreadKey,
	threadQuery,
	onProjectChange,
	onThreadQueryChange,
	onSelectThread,
	onCreateThread,
	footer,
}: SidebarProps) {
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const selectedProject =
		projects.find((project) => project.id === selectedProjectId) ?? projects[0];
	const visibleThreads = useMemo(
		() => (selectedProject ? filterThreads(selectedProject, threadQuery) : []),
		[selectedProject, threadQuery],
	);
	const threadGroups = useMemo(
		() => groupThreads(visibleThreads),
		[visibleThreads],
	);

	return (
		<aside
			className={cn("flex h-full min-h-0 flex-col", ui.sidePanel, className)}
		>
			<div className="relative shrink-0 px-2.5 pb-1 pt-2">
				<SurfaceAction
					className="h-11 w-full gap-2.5 px-2.5"
					name={
						selectedProject
							? projectResultTitle(selectedProject)
							: "Switch project"
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
								"absolute left-2.5 right-2.5 top-[54px] p-1.5",
								layer.localMenuZ,
								ui.popover,
							)}
							initial={{ opacity: 0, y: -8, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -8, scale: 0.98 }}
							transition={motionPresets.quick}
							role="menu"
						>
							{projects.map((project) => (
								<MenuItemButton
									key={project.id}
									className="min-h-[62px] w-full gap-2.5 px-2.5 py-2"
									role="menuitem"
									selected={project.id === selectedProjectId}
									title={projectResultTitle(project)}
									onClick={() => {
										onProjectChange(project.id);
										setProjectMenuOpen(false);
									}}
								>
									<ProjectResultRow project={project} />
									{project.id === selectedProjectId ? (
										<Check size={14} className="text-fg-strong" />
									) : null}
								</MenuItemButton>
							))}
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>

			<div
				className={cn(
					"flex shrink-0 items-center gap-2 px-2.5 pb-1.5 pt-0.5",
					ui.panelBand,
				)}
			>
				<div className="min-w-0 flex-1">
					<FieldShell icon={<Search size={14} />} className="h-9 w-full">
						<input
							type="search"
							className={cn(ui.input, ui.inputTextCompact)}
							value={threadQuery}
							onChange={(event) => onThreadQueryChange(event.target.value)}
							placeholder="Search threads"
							aria-label="Search threads"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
						/>
					</FieldShell>
				</div>
				<ControlButton
					className="h-9 w-9 shrink-0 bg-transparent"
					onClick={onCreateThread}
					name={codexThreadCommandLabels.new}
					aria-label={codexThreadCommandLabels.new}
				>
					<Plus size={16} />
				</ControlButton>
			</div>

			<div className="relative min-h-0 flex-1">
				<div className="mobile-keyboard-scroll h-full min-h-0 overflow-y-auto px-2.5 py-1.5 scroll-mask-y">
					<AnimatePresence mode="popLayout">
						<motion.div
							key={selectedProject?.id ?? "empty"}
							initial={{ opacity: 0, x: -10 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: 10 }}
							transition={motionPresets.item}
							className="grid gap-2.5"
						>
							{threadGroups.length === 0 ? (
								<ControlCard className="px-3 py-7 text-center text-[12px] text-muted">
									{threadQuery.trim()
										? "No matching threads"
										: "No Codex threads yet"}
								</ControlCard>
							) : null}
							{threadGroups.map((group) => (
								<section key={group.bucket} className="grid gap-0.5">
									<div className="px-2 pb-0.5 text-[12px] font-medium text-muted">
										{group.bucket}
									</div>
									{group.threads.map((thread) => {
										const selected =
											selectedThreadKey === thread.id ||
											selectedThreadKey === thread.threadId;
										return (
											<NavAction
												key={thread.id}
												className={cn(
													"group w-full items-start gap-2 px-2.5 py-1.5",
												)}
												selected={selected}
												name={threadResultTitle(thread)}
												onClick={() => onSelectThread(thread)}
											>
												<ThreadResultRow thread={thread} />
											</NavAction>
										);
									})}
								</section>
							))}
						</motion.div>
					</AnimatePresence>
				</div>
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-top" />
				<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-bottom" />
			</div>

			{footer}
		</aside>
	);
});
