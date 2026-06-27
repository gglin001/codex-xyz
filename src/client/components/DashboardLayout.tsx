import { AnimatePresence, motion, useDragControls } from "framer-motion";
import {
	Archive,
	GitFork,
	Goal,
	ListTree,
	Maximize2,
	Menu,
	Minimize2,
	Play,
	Plus,
	RefreshCw,
	Search,
	Settings,
	Square,
	SquareX,
	Sun,
	Terminal,
	TextCursorInput,
	WrapText,
	ZoomIn,
} from "lucide-react";
import type {
	KeyboardEvent,
	PointerEvent as ReactPointerEvent,
	SubmitEvent,
} from "react";
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ControlThread,
	ThreadDetail,
	ThreadDisplayStatus,
	ThreadTagScore,
} from "../../server/domain.js";
import { codexThreadCommandLabels } from "../codexCommandLabels.js";
import {
	cn,
	displayScale as displayScaleConfig,
	formatDisplayScale,
	ui,
} from "../designSystem.js";
import { isPromptFocusShortcut } from "../promptShortcut.js";
import { nextThemeMode, type ThemeMode, themeModeLabels } from "../theme.js";
import { useFullscreen } from "../useFullscreen.js";
import { useMobileViewportGeometry } from "../useMobileViewportGeometry.js";
import type { PwaState } from "../usePwa.js";
import { ParamPanel } from "./ParamPanel.js";
import {
	ProjectResultRow,
	projectResultDetail,
	projectResultTitle,
} from "./ProjectResultRow.js";
import { Sidebar } from "./Sidebar.js";
import {
	ThreadResultRow,
	threadResultSearchText,
	threadResultTitle,
} from "./ThreadResultRow.js";
import { ThreadStatusIcon } from "./threadStatusIcon.js";
import { FieldShell, MenuItemButton, SurfaceAction } from "./uiPrimitives.js";
import { Workspace, type WorkspaceHandle } from "./Workspace.js";
import type {
	ComposerMode,
	WorkbenchProject,
	WorkbenchThread,
} from "./workbenchTypes.js";

export type DashboardLayoutProps = {
	projects: WorkbenchProject[];
	selectedProjectId: string;
	selectedThreadKey: string | null;
	threadSummary: WorkbenchThread | null;
	detail: ThreadDetail | null;
	selectedThread: ControlThread | null;
	selectedThreadId: string | null;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	terminalVisible: boolean;
	wrapThreadContent: boolean;
	themeMode: ThemeMode;
	threadQuery: string;
	defaultCwd: string;
	workdir: string;
	busy: boolean;
	busyAction: string | null;
	notice: string | null;
	onDismissNotice: () => void;
	error: string | null;
	onDismissError: () => void;
	prompt: string;
	promptTarget: ComposerMode;
	goalMode: boolean;
	canUseGoalMode: boolean;
	canSubmitPrompt: boolean;
	onNavigatorVisibleChange: (visible: boolean) => void;
	onInspectorVisibleChange: (visible: boolean) => void;
	onWrapThreadContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	pwa: PwaState;
	displayScale: number;
	onDisplayScaleChange: (value: number) => void;
	onThreadTagScoreChange: (value: ThreadTagScore | null) => void;
	onProjectChange: (projectId: string) => void;
	onSelectThread: (
		threadSummary: WorkbenchThread,
		options?: { clearThreadQuery?: boolean },
	) => void;
	onCreateThread: () => void;
	onThreadQueryChange: (value: string) => void;
	onTerminalVisibleChange: (visible: boolean) => void;
	onPromptChange: (value: string) => void;
	onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onPromptSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
	onModeChange: (mode: ComposerMode) => void;
	onWorkdirChange: (value: string) => void;
	onGoalModeChange: (value: boolean) => void;
	onInterrupt: () => void;
	onResume: () => void;
	onFork: () => void;
	onCompact: () => void;
	onArchive: () => void;
	onListBackgroundTerminals: () => void;
	onCleanBackgroundTerminals: () => void;
	onRestartCodexAppServer: () => void;
};

type CommandActionBase = {
	id: string;
	name: string;
	detail: string;
	run: () => void;
	disabled?: boolean;
	disabledDetail?: string;
};

type CommandAction =
	| (CommandActionBase & {
			kind: "navigator" | "terminal" | "prompt";
	  })
	| (CommandActionBase & {
			kind: "project";
			projectId: string;
			projectInitials: string;
			project: WorkbenchProject;
	  })
	| (CommandActionBase & {
			kind: "thread";
			projectId: string;
			status: ThreadDisplayStatus;
			thread: WorkbenchThread;
			projectName: string;
	  })
	| (CommandActionBase & {
			kind: "settingsGroup";
			settingsGroupId: string;
	  })
	| (CommandActionBase & {
			kind: "settingsItem";
			settingsGroupId: string;
			icon:
				| "fullscreen"
				| "goal"
				| "restart"
				| "settings"
				| "theme"
				| "wrap"
				| "zoom";
	  })
	| (CommandActionBase & {
			kind: "slashGroup";
			slashGroupId: string;
	  })
	| (CommandActionBase & {
			kind: "slashItem";
			slashGroupId: string;
			icon:
				| "archive"
				| "compact"
				| "fork"
				| "goal"
				| "interrupt"
				| "ps"
				| "new"
				| "resume"
				| "stop";
	  });

type CommandActionRenderItem = {
	action: CommandAction;
	parentHasVisibleChildren: boolean;
};

type MobileSheet = "navigator" | "inspector";

const spring = { type: "spring", stiffness: 360, damping: 36 } as const;
const dragDismissThreshold = 80;
const mobileViewportQuery = "(max-width: 767px)";
const mobileHandleClass = "h-1 w-14 rounded-full bg-control-hover";
const mobileSheetClass =
	"mobile-sheet-surface absolute inset-x-0 top-[var(--mobile-sheet-top)] flex h-[var(--mobile-sheet-height)] flex-col overflow-hidden rounded-t-[16px]";

function isMobileViewport() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia(mobileViewportQuery).matches
	);
}

type ResponsiveViewportMode = "desktop" | "mobile";

function useResponsiveViewportMode() {
	const [viewportMode, setViewportMode] =
		useState<ResponsiveViewportMode | null>(null);

	useEffect(() => {
		const mediaQuery = window.matchMedia(mobileViewportQuery);
		const updateViewportMode = () => {
			setViewportMode(mediaQuery.matches ? "mobile" : "desktop");
		};

		updateViewportMode();
		mediaQuery.addEventListener("change", updateViewportMode);
		return () => {
			mediaQuery.removeEventListener("change", updateViewportMode);
		};
	}, []);

	return viewportMode;
}

function blurActiveElement() {
	const activeElement = document.activeElement;
	if (activeElement instanceof HTMLElement) {
		activeElement.blur();
	}
}

function activeElement() {
	const active = document.activeElement;
	return active instanceof HTMLElement ? active : null;
}

const focusableSelector = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

function isTextEntryElement(element: HTMLElement) {
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element.isContentEditable
	);
}

function restoreFocus(element: HTMLElement | null) {
	if (!element?.isConnected) {
		return;
	}
	if (isMobileViewport() && isTextEntryElement(element)) {
		return;
	}
	window.requestAnimationFrame(() => {
		element.focus({ preventScroll: true });
	});
}

function focusableElements(container: HTMLElement | null) {
	if (!container) {
		return [];
	}
	return Array.from(
		container.querySelectorAll<HTMLElement>(focusableSelector),
	).filter((element) => {
		const style = window.getComputedStyle(element);
		return (
			style.visibility !== "hidden" &&
			style.display !== "none" &&
			element.getAttribute("aria-hidden") !== "true"
		);
	});
}

function cycleDialogFocus(
	event: KeyboardEvent<HTMLElement>,
	container: HTMLElement | null,
) {
	if (event.key !== "Tab") {
		return;
	}
	const focusable = focusableElements(container);
	if (focusable.length === 0) {
		event.preventDefault();
		container?.focus({ preventScroll: true });
		return;
	}
	const current = activeElement();
	const currentIndex = current ? focusable.indexOf(current) : -1;
	const nextIndex = event.shiftKey
		? currentIndex <= 0
			? focusable.length - 1
			: currentIndex - 1
		: currentIndex === -1 || currentIndex === focusable.length - 1
			? 0
			: currentIndex + 1;
	event.preventDefault();
	focusable[nextIndex]?.focus({ preventScroll: true });
}

type MobileSheetHandleProps = {
	onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

const MobileSheetHandle = forwardRef<HTMLDivElement, MobileSheetHandleProps>(
	function MobileSheetHandle({ onPointerDown }, ref) {
		return (
			<div
				ref={ref}
				className={cn(
					"flex h-7 shrink-0 items-start justify-center pt-2",
					onPointerDown
						? "cursor-grab touch-none active:cursor-grabbing"
						: "pointer-events-none",
				)}
				onPointerDown={onPointerDown}
				aria-hidden="true"
			>
				<span className={mobileHandleClass} />
			</div>
		);
	},
);

function shouldStartSheetDrag(event: ReactPointerEvent<HTMLDivElement>) {
	return event.pointerType !== "mouse" || event.button === 0;
}

function startSheetDrag(
	event: ReactPointerEvent<HTMLDivElement>,
	dragControls: ReturnType<typeof useDragControls>,
) {
	if (!shouldStartSheetDrag(event)) {
		return;
	}
	dragControls.start(event);
}

function isMobileSheetDragEnabled() {
	return isMobileViewport();
}

function startMobileSheetDrag(
	event: ReactPointerEvent<HTMLDivElement>,
	dragControls: ReturnType<typeof useDragControls>,
) {
	if (!isMobileSheetDragEnabled()) {
		return;
	}
	startSheetDrag(event, dragControls);
}

function commandActionMatches(action: CommandAction, normalizedQuery: string) {
	const searchable =
		action.kind === "thread"
			? threadResultSearchText(action.thread, action.projectName)
			: `${action.name} ${action.detail}`;
	return searchable.toLowerCase().includes(normalizedQuery);
}

function commandParentId(action: CommandAction) {
	if (action.kind === "thread") {
		return `project:${action.projectId}`;
	}
	if (action.kind === "settingsItem") {
		return `settings:${action.settingsGroupId}`;
	}
	if (action.kind === "slashItem") {
		return `slash:${action.slashGroupId}`;
	}
	return null;
}

function filterCommandActions(
	actions: CommandAction[],
	normalizedQuery: string,
) {
	if (!normalizedQuery) {
		return actions;
	}

	const directMatches = new Set<string>();
	const parentsWithMatchingChildren = new Set<string>();

	for (const action of actions) {
		if (commandActionMatches(action, normalizedQuery)) {
			directMatches.add(action.id);
			const parentId = commandParentId(action);
			if (parentId) {
				parentsWithMatchingChildren.add(parentId);
			}
		}
	}

	return actions.filter((action) => {
		if (directMatches.has(action.id)) {
			return true;
		}
		return parentsWithMatchingChildren.has(action.id);
	});
}

function annotateCommandActions(
	actions: CommandAction[],
): CommandActionRenderItem[] {
	const visibleChildCounts = new Map<string, number>();
	for (const action of actions) {
		const parentId = commandParentId(action);
		if (parentId) {
			visibleChildCounts.set(
				parentId,
				(visibleChildCounts.get(parentId) ?? 0) + 1,
			);
		}
	}

	return actions.map((action) => {
		const parentId = commandParentId(action);
		if (!parentId) {
			return {
				action,
				parentHasVisibleChildren: (visibleChildCounts.get(action.id) ?? 0) > 0,
			};
		}

		return {
			action,
			parentHasVisibleChildren: false,
		};
	});
}

function CommandActionGlyph({
	action,
	parentHasVisibleChildren,
}: CommandActionRenderItem) {
	if (action.kind === "project") {
		return (
			<span
				className="relative flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				{parentHasVisibleChildren ? (
					<span className="absolute -bottom-1 left-3.5 h-2 w-1 rounded-full bg-control-hover" />
				) : null}
				<span
					className={cn(
						"h-8 w-8 font-semibold text-[11px] text-fg-strong",
						ui.iconBox,
					)}
				>
					{action.projectInitials}
				</span>
			</span>
		);
	}

	if (action.kind === "settingsGroup") {
		return (
			<span
				className="relative flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				{parentHasVisibleChildren ? (
					<span className="absolute -bottom-1 left-3.5 h-2 w-1 rounded-full bg-control-hover" />
				) : null}
				<span className={cn("h-8 w-8 text-muted-strong", ui.iconBox)}>
					<Settings size={14} />
				</span>
			</span>
		);
	}

	if (action.kind === "slashGroup") {
		return (
			<span
				className="relative flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				{parentHasVisibleChildren ? (
					<span className="absolute -bottom-1 left-3.5 h-2 w-1 rounded-full bg-control-hover" />
				) : null}
				<span
					className={cn(
						"h-8 w-8 font-mono text-[16px] text-muted-strong",
						ui.iconBox,
					)}
				>
					/
				</span>
			</span>
		);
	}

	if (action.kind === "thread") {
		return (
			<span
				className="relative flex h-8 w-12 shrink-0 items-center"
				aria-hidden="true"
			>
				<span className="absolute left-1 top-1 h-6 w-8 rounded-[8px] bg-control/35" />
				<span
					className={cn(
						"absolute right-0 top-0 h-8 w-8 text-muted-strong",
						ui.iconBox,
					)}
				>
					<ThreadStatusIcon status={action.status} />
				</span>
			</span>
		);
	}

	if (action.kind === "slashItem") {
		const itemIcon =
			action.icon === "archive" ? (
				<Archive size={14} />
			) : action.icon === "compact" ? (
				<Minimize2 size={14} />
			) : action.icon === "fork" ? (
				<GitFork size={14} />
			) : action.icon === "goal" ? (
				<Goal size={14} />
			) : action.icon === "interrupt" ? (
				<Square size={14} />
			) : action.icon === "ps" ? (
				<ListTree size={14} />
			) : action.icon === "new" ? (
				<Plus size={14} />
			) : action.icon === "stop" ? (
				<SquareX size={14} />
			) : (
				<Play size={14} />
			);
		return (
			<span
				className="relative flex h-8 w-12 shrink-0 items-center"
				aria-hidden="true"
			>
				<span className="absolute left-1 top-1 h-6 w-8 rounded-[8px] bg-control/35" />
				<span
					className={cn(
						"absolute right-0 top-0 h-8 w-8 text-muted-strong",
						ui.iconBox,
					)}
				>
					{itemIcon}
				</span>
			</span>
		);
	}

	if (action.kind === "settingsItem") {
		const itemIcon =
			action.icon === "goal" ? (
				<Goal size={14} />
			) : action.icon === "theme" ? (
				<Sun size={14} />
			) : action.icon === "wrap" ? (
				<WrapText size={14} />
			) : action.icon === "zoom" ? (
				<ZoomIn size={14} />
			) : action.icon === "fullscreen" ? (
				<Maximize2 size={14} />
			) : action.icon === "restart" ? (
				<RefreshCw size={14} />
			) : (
				<Settings size={14} />
			);
		return (
			<span
				className="relative flex h-8 w-12 shrink-0 items-center"
				aria-hidden="true"
			>
				<span className="absolute left-1 top-1 h-6 w-8 rounded-[8px] bg-control/35" />
				<span
					className={cn(
						"absolute right-0 top-0 h-8 w-8 text-muted-strong",
						ui.iconBox,
					)}
				>
					{itemIcon}
				</span>
			</span>
		);
	}

	const icon =
		action.kind === "navigator" ? (
			<Menu size={14} />
		) : action.kind === "terminal" ? (
			<Terminal size={14} />
		) : (
			<TextCursorInput size={14} />
		);

	return (
		<span
			className={cn("h-8 w-8 text-muted-strong", ui.iconBox)}
			aria-hidden="true"
		>
			{icon}
		</span>
	);
}

const CommandPalette = memo(function CommandPalette({
	open,
	actions,
	autoFocusInput,
	onClose,
}: {
	open: boolean;
	actions: CommandAction[];
	autoFocusInput: boolean;
	onClose: (options?: { restoreFocus?: boolean }) => void;
}) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const dragControls = useDragControls();

	const filteredActions = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return filterCommandActions(actions, normalized);
	}, [actions, query]);
	const renderItems = useMemo(
		() => annotateCommandActions(filteredActions),
		[filteredActions],
	);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setActiveIndex(0);
			return;
		}
		if (!autoFocusInput) {
			const frame = window.requestAnimationFrame(() => {
				panelRef.current?.focus({ preventScroll: true });
			});
			return () => window.cancelAnimationFrame(frame);
		}
		const frame = window.requestAnimationFrame(() => {
			inputRef.current?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [autoFocusInput, open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		setActiveIndex((index) => {
			if (filteredActions.length === 0) {
				return 0;
			}
			return Math.min(index, filteredActions.length - 1);
		});
	}, [filteredActions.length, open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const activeItem = listRef.current?.querySelector<HTMLElement>(
			`[data-command-index="${activeIndex}"]`,
		);
		activeItem?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const runActive = useCallback(() => {
		const action = filteredActions[activeIndex];
		if (!action || action.disabled) {
			return;
		}
		action.run();
		onClose({ restoreFocus: false });
	}, [activeIndex, filteredActions, onClose]);

	return (
		<AnimatePresence>
			{open ? (
				<motion.div
					className={cn(
						"fixed inset-0 z-[120] flex items-start justify-center md:px-6 md:pt-[clamp(56px,10vh,96px)]",
						ui.overlay,
					)}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={spring}
					onMouseDown={() => onClose()}
				>
					<motion.div
						ref={panelRef}
						className={cn(
							mobileSheetClass,
							"px-0 md:static md:h-auto md:max-h-[min(40rem,calc(100dvh_-_7rem))] md:w-[44rem] md:max-w-[calc(100vw_-_2rem)] md:rounded-[12px]",
							ui.popover,
						)}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-label="Command palette"
						initial={
							isMobileViewport()
								? { y: "100%", opacity: 0 }
								: { opacity: 0, y: -12, scale: 0.98 }
						}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={
							isMobileViewport()
								? { y: "100%", opacity: 0 }
								: { opacity: 0, y: -12, scale: 0.98 }
						}
						transition={
							isMobileViewport()
								? spring
								: { type: "spring", stiffness: 420, damping: 34 }
						}
						drag={isMobileViewport() ? "y" : false}
						dragControls={dragControls}
						dragListener={false}
						dragConstraints={{ top: 0, bottom: 0 }}
						dragElastic={{ top: 0, bottom: 0.4 }}
						dragMomentum={false}
						onDragEnd={(_event, info) => {
							if (
								info.offset.y > dragDismissThreshold ||
								info.velocity.y > 600
							) {
								onClose();
							}
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								onClose();
								return;
							}
							cycleDialogFocus(event, panelRef.current);
						}}
						onMouseDown={(event) => event.stopPropagation()}
					>
						<div className="md:hidden">
							<MobileSheetHandle
								onPointerDown={(event) => {
									startMobileSheetDrag(event, dragControls);
								}}
							/>
						</div>
						<div className="px-2 py-2">
							<FieldShell icon={<Search size={16} />} className="h-10 w-full">
								<input
									type="search"
									ref={inputRef}
									className={cn(ui.input, "h-[1lh] text-[14px] leading-5")}
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										setActiveIndex(0);
									}}
									placeholder="Search Anything"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.preventDefault();
											onClose();
											return;
										}
										if (event.key === "ArrowDown") {
											event.preventDefault();
											setActiveIndex((index) => {
												if (filteredActions.length === 0) {
													return 0;
												}
												return Math.min(filteredActions.length - 1, index + 1);
											});
										}
										if (event.key === "ArrowUp") {
											event.preventDefault();
											setActiveIndex((index) => Math.max(0, index - 1));
										}
										if (event.key === "Enter") {
											event.preventDefault();
											runActive();
										}
									}}
								/>
							</FieldShell>
						</div>
						<div
							ref={listRef}
							className="mobile-keyboard-scroll min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[min(31rem,calc(100dvh_-_12rem))]"
						>
							{filteredActions.length === 0 ? (
								<div className="px-3 py-8 text-center text-[13px] text-muted">
									No commands found
								</div>
							) : null}
							{renderItems.map(
								({ action, parentHasVisibleChildren }, index) => (
									<MenuItemButton
										key={action.id}
										data-command-index={index}
										className={cn(
											action.kind === "thread"
												? "min-h-[78px] w-full items-start gap-2.5 px-2.5 py-2"
												: action.kind === "project"
													? "min-h-[66px] w-full items-start gap-2.5 px-2.5 py-2"
													: "h-11 w-full gap-2.5 px-2.5",
											index === activeIndex ? null : "bg-transparent",
											action.disabled ? "opacity-45" : null,
										)}
										title={
											action.kind === "thread"
												? threadResultTitle(action.thread, action.projectName)
												: action.kind === "project"
													? projectResultTitle(action.project)
													: action.detail
										}
										selected={index === activeIndex}
										disabled={action.disabled}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => {
											if (action.disabled) {
												return;
											}
											action.run();
											onClose({ restoreFocus: false });
										}}
									>
										<CommandActionGlyph
											action={action}
											parentHasVisibleChildren={parentHasVisibleChildren}
										/>
										{action.kind === "thread" ? (
											<ThreadResultRow
												thread={action.thread}
												projectName={action.projectName}
												showStatusIcon={false}
											/>
										) : action.kind === "project" ? (
											<ProjectResultRow
												project={action.project}
												showAvatar={false}
											/>
										) : (
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[13px] font-medium">
													{action.name}
												</span>
												<span className="block truncate text-[11px] text-muted">
													{action.disabled
														? (action.disabledDetail ?? action.detail)
														: action.detail}
												</span>
											</span>
										)}
									</MenuItemButton>
								),
							)}
						</div>
					</motion.div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
});

export const DashboardLayout = memo(function DashboardLayout({
	projects,
	selectedProjectId,
	selectedThreadKey,
	threadSummary,
	detail,
	selectedThread,
	selectedThreadId,
	navigatorVisible,
	inspectorVisible,
	terminalVisible,
	wrapThreadContent,
	themeMode,
	threadQuery,
	defaultCwd,
	workdir,
	busy,
	busyAction,
	notice,
	onDismissNotice,
	error,
	onDismissError,
	prompt,
	promptTarget,
	goalMode,
	canUseGoalMode,
	canSubmitPrompt,
	onNavigatorVisibleChange,
	onInspectorVisibleChange,
	onWrapThreadContentChange,
	onThemeModeChange,
	pwa,
	displayScale,
	onDisplayScaleChange,
	onThreadTagScoreChange,
	onProjectChange,
	onSelectThread,
	onCreateThread,
	onThreadQueryChange,
	onTerminalVisibleChange,
	onPromptChange,
	onPromptKeyDown,
	onPromptSubmit,
	onModeChange,
	onWorkdirChange,
	onGoalModeChange,
	onInterrupt,
	onResume,
	onFork,
	onCompact,
	onArchive,
	onListBackgroundTerminals,
	onCleanBackgroundTerminals,
	onRestartCodexAppServer,
}: DashboardLayoutProps) {
	const [mobileSheet, setMobileSheet] = useState<MobileSheet | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandAutoFocusInput, setCommandAutoFocusInput] = useState(true);
	const desktopWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const mobileWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const commandReturnFocusRef = useRef<HTMLElement | null>(null);
	const mobileSheetReturnFocusRef = useRef<HTMLElement | null>(null);
	const mobileSheetPanelRef = useRef<HTMLDivElement | null>(null);
	const mobileSheetDragControls = useDragControls();
	const viewportMode = useResponsiveViewportMode();
	const renderDesktopShell = viewportMode !== "mobile";
	const renderMobileShell = viewportMode !== "desktop";
	const {
		isFullscreen,
		toggle: toggleFullscreen,
		supported: fullscreenSupported,
	} = useFullscreen();

	const selectedProject =
		projects.find((project) => project.id === selectedProjectId) ??
		projects[0] ??
		null;

	useMobileViewportGeometry();

	const focusVisiblePrompt = useCallback(() => {
		const useDesktopWorkspace =
			typeof window.matchMedia === "function"
				? window.matchMedia("(min-width: 768px)").matches
				: true;
		const workspace = useDesktopWorkspace
			? desktopWorkspaceRef.current
			: mobileWorkspaceRef.current;
		return workspace?.focusPrompt() ?? false;
	}, []);

	const createThreadAndFocusPrompt = useCallback(() => {
		onCreateThread();
		window.requestAnimationFrame(focusVisiblePrompt);
	}, [focusVisiblePrompt, onCreateThread]);

	const closeCommandPalette = useCallback(
		(options: { restoreFocus?: boolean } = {}) => {
			const restore = options.restoreFocus ?? true;
			const returnFocusTarget = commandReturnFocusRef.current;
			commandReturnFocusRef.current = null;
			setCommandOpen(false);
			if (restore) {
				restoreFocus(returnFocusTarget);
			}
		},
		[],
	);

	const closeMobileSheet = useCallback(
		(options: { restoreFocus?: boolean } = {}) => {
			const restore = options.restoreFocus ?? true;
			const returnFocusTarget = mobileSheetReturnFocusRef.current;
			mobileSheetReturnFocusRef.current = null;
			setMobileSheet(null);
			if (restore) {
				restoreFocus(returnFocusTarget);
			}
		},
		[],
	);

	const openCommandPalette = useCallback(
		(options?: { autoFocusInput?: boolean }) => {
			const autoFocusInput = options?.autoFocusInput ?? !isMobileViewport();
			commandReturnFocusRef.current = activeElement();
			setCommandAutoFocusInput(autoFocusInput);
			if (!autoFocusInput) {
				blurActiveElement();
			}
			closeMobileSheet({ restoreFocus: false });
			setCommandOpen(true);
		},
		[closeMobileSheet],
	);

	const openMobileSheet = useCallback(
		(sheet: MobileSheet) => {
			if (mobileSheet === sheet) {
				closeMobileSheet();
				return;
			}
			mobileSheetReturnFocusRef.current = activeElement();
			blurActiveElement();
			closeCommandPalette({ restoreFocus: false });
			onTerminalVisibleChange(false);
			setMobileSheet(sheet);
		},
		[
			closeCommandPalette,
			closeMobileSheet,
			mobileSheet,
			onTerminalVisibleChange,
		],
	);

	useEffect(() => {
		if (viewportMode === "desktop") {
			closeMobileSheet({ restoreFocus: false });
		}
	}, [closeMobileSheet, viewportMode]);

	useEffect(() => {
		if (!mobileSheet) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			mobileSheetPanelRef.current?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [mobileSheet]);

	const openCommandPaletteFromSwipe = useCallback(() => {
		openCommandPalette({ autoFocusInput: false });
	}, [openCommandPalette]);

	const toggleCommandPalette = useCallback(() => {
		if (commandOpen) {
			closeCommandPalette();
			return;
		}
		openCommandPalette();
	}, [closeCommandPalette, commandOpen, openCommandPalette]);

	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				closeCommandPalette();
				closeMobileSheet();
				return;
			}
			if (!commandOpen && isPromptFocusShortcut(event)) {
				event.preventDefault();
				closeCommandPalette({ restoreFocus: false });
				closeMobileSheet({ restoreFocus: false });
				window.requestAnimationFrame(focusVisiblePrompt);
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				toggleCommandPalette();
			}
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [
		closeCommandPalette,
		closeMobileSheet,
		commandOpen,
		focusVisiblePrompt,
		toggleCommandPalette,
	]);

	useEffect(() => {
		if (terminalVisible) {
			closeMobileSheet({ restoreFocus: false });
		}
	}, [closeMobileSheet, terminalVisible]);

	const commandActions = useMemo<CommandAction[]>(() => {
		const setNavigatorVisible = () => {
			if (isMobileViewport()) {
				openMobileSheet("navigator");
				return;
			}
			onNavigatorVisibleChange(!navigatorVisible);
		};
		const setInspectorVisible = () => {
			if (isMobileViewport()) {
				openMobileSheet("inspector");
				return;
			}
			onInspectorVisibleChange(!inspectorVisible);
		};
		const showTerminal = () => {
			closeMobileSheet({ restoreFocus: false });
			onTerminalVisibleChange(true);
		};
		const focusPrompt = () => {
			closeMobileSheet({ restoreFocus: false });
			window.requestAnimationFrame(focusVisiblePrompt);
		};
		const selectedThreadArchived = Boolean(selectedThread?.archivedAt);
		const canInterrupt =
			selectedThread?.status === "active" && !selectedThreadArchived && !busy;
		const canResume =
			Boolean(selectedThreadId) &&
			selectedThread?.status !== "active" &&
			!selectedThreadArchived &&
			!busy;
		const canFork =
			Boolean(selectedThreadId) && !selectedThreadArchived && !busy;
		const canCompact =
			Boolean(selectedThreadId) &&
			selectedThread?.status !== "active" &&
			!selectedThreadArchived &&
			!busy;
		const canArchive =
			Boolean(selectedThreadId) &&
			selectedThread?.status !== "active" &&
			!selectedThreadArchived &&
			!busy;
		const canUseBackgroundTerminals =
			Boolean(selectedThreadId) && !selectedThreadArchived && !busy;
		const actions: CommandAction[] = [
			{
				id: "focus-prompt",
				name: "Prompt",
				detail: "Jump to the composer input",
				kind: "prompt",
				run: focusPrompt,
			},
			{
				id: "toggle-navigator",
				name: "Threads",
				detail: "Open the project and thread list",
				kind: "navigator",
				run: setNavigatorVisible,
			},
			{
				id: "open-terminal",
				name: "Terminal",
				detail: "Open the terminal dock",
				kind: "terminal",
				run: showTerminal,
			},
			{
				id: "settings:panel",
				name: "Settings",
				detail: isMobileViewport()
					? "Open settings and transcript controls"
					: "Toggle settings and transcript controls",
				kind: "settingsGroup",
				settingsGroupId: "panel",
				run: setInspectorVisible,
			},
			{
				id: "settings:toggle-theme",
				name: "Theme",
				detail: `Current appearance ${themeModeLabels[themeMode]}`,
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "theme",
				run: () => onThemeModeChange(nextThemeMode(themeMode)),
			},
			{
				id: "settings:toggle-wrap",
				name: "Wrap",
				detail: wrapThreadContent
					? "Long transcript lines will scroll horizontally"
					: "Long transcript lines will wrap",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "wrap",
				run: () => onWrapThreadContentChange(!wrapThreadContent),
			},
			{
				id: "settings:reset-scale",
				name: "Scale",
				detail: `Return to ${formatDisplayScale(displayScaleConfig.defaultValue)}`,
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "zoom",
				disabled: displayScale === displayScaleConfig.defaultValue,
				disabledDetail: `Already at ${formatDisplayScale(displayScaleConfig.defaultValue)}`,
				run: () => onDisplayScaleChange(displayScaleConfig.defaultValue),
			},
			{
				id: "settings:toggle-fullscreen",
				name: "Fullscreen",
				detail: "Use the whole browser viewport",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "fullscreen",
				disabled: !fullscreenSupported,
				disabledDetail: "Full screen is not available in this browser",
				run: toggleFullscreen,
			},
			{
				id: "settings:restart-app-server",
				name: "Restart app-server",
				detail: "Restart the Codex app-server process",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "restart",
				disabled: busy,
				disabledDetail: "Another action is running",
				run: onRestartCodexAppServer,
			},
			{
				id: "slash:root",
				name: "/",
				detail: "Jump to the composer input",
				kind: "slashGroup",
				slashGroupId: "root",
				run: focusPrompt,
			},
			{
				id: "slash:archive",
				name: codexThreadCommandLabels.archive,
				detail: "Archive the current chat",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "archive",
				disabled: !canArchive,
				disabledDetail: "Select an idle thread before archiving",
				run: onArchive,
			},
			{
				id: "slash:compact",
				name: codexThreadCommandLabels.compact,
				detail: "Summarize conversation to prevent hitting the context limit",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "compact",
				disabled: !canCompact,
				disabledDetail: "Select an idle thread before compacting",
				run: onCompact,
			},
			{
				id: "slash:interrupt",
				name: codexThreadCommandLabels.interrupt,
				detail: "Interrupt the active turn",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "interrupt",
				disabled: !canInterrupt,
				disabledDetail: "No active turn is running",
				run: onInterrupt,
			},
			{
				id: "slash:fork",
				name: codexThreadCommandLabels.fork,
				detail: "Fork the current chat",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "fork",
				disabled: !canFork,
				disabledDetail: "Select a thread before forking",
				run: onFork,
			},
			{
				id: "slash:ps",
				name: codexThreadCommandLabels.ps,
				detail: "List app-server background terminals",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "ps",
				disabled: !canUseBackgroundTerminals,
				disabledDetail: "Select a thread before listing terminals",
				run: onListBackgroundTerminals,
			},
			{
				id: "slash:stop",
				name: codexThreadCommandLabels.stop,
				detail: "Stop app-server background terminals",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "stop",
				disabled: !canUseBackgroundTerminals,
				disabledDetail: "Select a thread before stopping terminals",
				run: onCleanBackgroundTerminals,
			},
			{
				id: "slash:goal",
				name: codexThreadCommandLabels.goal,
				detail: goalMode
					? "Composer will send normal prompts"
					: "Composer will start or continue a goal",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "goal",
				disabled: !goalMode && !canUseGoalMode,
				disabledDetail:
					"Select a thread or working directory before using goal mode",
				run: () => onGoalModeChange(!goalMode),
			},
			{
				id: "slash:new",
				name: codexThreadCommandLabels.new,
				detail: "Start a fresh Codex app-server thread",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "new",
				run: createThreadAndFocusPrompt,
			},
			{
				id: "slash:resume",
				name: codexThreadCommandLabels.resume,
				detail: "Resume a saved chat",
				kind: "slashItem",
				slashGroupId: "root",
				icon: "resume",
				disabled: !canResume,
				disabledDetail: "Select an idle thread before resuming",
				run: onResume,
			},
		];

		for (const project of projects) {
			actions.push({
				id: `project:${project.id}`,
				name: project.name,
				detail: projectResultDetail(project),
				kind: "project",
				projectId: project.id,
				projectInitials: project.initials,
				project,
				run: () => onProjectChange(project.id),
			});
			for (const projectThread of project.threads) {
				actions.push({
					id: `thread:${projectThread.id}`,
					name: projectThread.name,
					detail: threadResultSearchText(projectThread, project.name),
					kind: "thread",
					projectId: project.id,
					status: projectThread.status,
					thread: projectThread,
					projectName: project.name,
					run: () => {
						onSelectThread(projectThread, { clearThreadQuery: true });
					},
				});
			}
		}

		return actions;
	}, [
		canUseGoalMode,
		busy,
		displayScale,
		focusVisiblePrompt,
		fullscreenSupported,
		goalMode,
		inspectorVisible,
		navigatorVisible,
		themeMode,
		toggleFullscreen,
		wrapThreadContent,
		selectedThread,
		selectedThreadId,
		createThreadAndFocusPrompt,
		onArchive,
		onDisplayScaleChange,
		onCompact,
		onFork,
		onGoalModeChange,
		onInspectorVisibleChange,
		onInterrupt,
		onListBackgroundTerminals,
		onNavigatorVisibleChange,
		onResume,
		onCleanBackgroundTerminals,
		onTerminalVisibleChange,
		onThemeModeChange,
		onWrapThreadContentChange,
		closeMobileSheet,
		openMobileSheet,
		onProjectChange,
		onRestartCodexAppServer,
		onSelectThread,
		projects,
	]);

	const toggleDesktopTerminal = useCallback(() => {
		onTerminalVisibleChange(!terminalVisible);
	}, [onTerminalVisibleChange, terminalVisible]);

	const toggleNavigator = useCallback(() => {
		if (isMobileViewport()) {
			openMobileSheet("navigator");
			return;
		}
		onNavigatorVisibleChange(!navigatorVisible);
	}, [navigatorVisible, onNavigatorVisibleChange, openMobileSheet]);

	const toggleInspector = useCallback(() => {
		if (isMobileViewport()) {
			openMobileSheet("inspector");
			return;
		}
		onInspectorVisibleChange(!inspectorVisible);
	}, [inspectorVisible, onInspectorVisibleChange, openMobileSheet]);

	const sidebarFooter = (
		<div className="shrink-0 bg-panel/70 p-3">
			<div className="mb-2.5 grid grid-cols-2 gap-2">
				<SurfaceAction
					className={cn(
						"h-10 justify-center gap-2 px-2 text-[12px] font-medium",
						terminalVisible ? null : "text-muted-strong",
					)}
					title="Toggle terminal"
					aria-label="Toggle terminal"
					selected={terminalVisible}
					onClick={toggleDesktopTerminal}
				>
					<Terminal size={14} />
					<span className="truncate">Terminal</span>
				</SurfaceAction>
				<SurfaceAction
					className={cn(
						"h-10 justify-center gap-2 px-2 text-[12px] font-medium",
						inspectorVisible ? null : "text-muted-strong",
					)}
					title={inspectorVisible ? "Hide settings" : "Open settings"}
					aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
					selected={inspectorVisible}
					onClick={toggleInspector}
				>
					<Settings size={14} />
					<span className="truncate">Settings</span>
				</SurfaceAction>
			</div>

			<SurfaceAction
				className="h-10 w-full gap-2.5 px-2.5"
				title="Open commands"
				aria-label="Open commands"
				onClick={() => openCommandPalette()}
			>
				<span
					className={cn(
						"h-7 w-7 font-mono text-[15px] leading-none",
						ui.iconBox,
					)}
					aria-hidden="true"
				>
					⌘
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[12px] font-medium text-fg-strong">
						Commands
					</span>
				</span>
				<span
					className="shrink-0 font-mono text-[12px] leading-none text-muted"
					aria-hidden="true"
				>
					Cmd K
				</span>
			</SurfaceAction>
		</div>
	);

	const sidebar = (
		<Sidebar
			projects={projects}
			selectedProjectId={selectedProjectId}
			selectedThreadKey={selectedThreadKey}
			threadQuery={threadQuery}
			onProjectChange={onProjectChange}
			onThreadQueryChange={onThreadQueryChange}
			onSelectThread={onSelectThread}
			onCreateThread={createThreadAndFocusPrompt}
			footer={sidebarFooter}
		/>
	);

	const inspector = (
		<ParamPanel
			threadSummary={threadSummary}
			detail={detail}
			selectedThread={selectedThread}
			wrapThreadContent={wrapThreadContent}
			themeMode={themeMode}
			displayScale={displayScale}
			onDisplayScaleChange={onDisplayScaleChange}
			defaultCwd={defaultCwd}
			onWrapThreadContentChange={onWrapThreadContentChange}
			onThemeModeChange={onThemeModeChange}
			pwa={pwa}
			fullscreenSupported={fullscreenSupported}
			isFullscreen={isFullscreen}
			onToggleFullscreen={toggleFullscreen}
			onThreadTagScoreChange={onThreadTagScoreChange}
			restartCodexAppServerDisabled={busy}
			onRestartCodexAppServer={onRestartCodexAppServer}
		/>
	);

	return (
		<main
			className={cn(
				"h-[var(--app-visual-height)] min-h-0 w-full overflow-hidden md:h-dvh",
				ui.appShell,
			)}
		>
			{renderDesktopShell ? (
				<div className="hidden h-full min-h-0 md:flex">
					<AnimatePresence initial={false}>
						{navigatorVisible ? (
							<motion.div
								key="desktop-sidebar"
								className="h-full min-h-0 shrink-0 overflow-hidden"
								initial={{ width: 0, opacity: 0 }}
								animate={{ width: 316, opacity: 1 }}
								exit={{ width: 0, opacity: 0 }}
								transition={spring}
							>
								{sidebar}
							</motion.div>
						) : null}
					</AnimatePresence>

					<div className="min-h-0 min-w-0 flex-1">
						<Workspace
							ref={desktopWorkspaceRef}
							presentationMode="desktop"
							project={selectedProject}
							threadSummary={threadSummary}
							detail={detail}
							selectedThread={selectedThread}
							selectedThreadId={selectedThreadId}
							workdir={workdir}
							busy={busy}
							busyAction={busyAction}
							notice={notice}
							onDismissNotice={onDismissNotice}
							error={error}
							onDismissError={onDismissError}
							prompt={prompt}
							promptTarget={promptTarget}
							goalMode={goalMode}
							canUseGoalMode={canUseGoalMode}
							canSubmitPrompt={canSubmitPrompt}
							wrapThreadContent={wrapThreadContent}
							displayScale={displayScale}
							navigatorVisible={navigatorVisible}
							inspectorVisible={inspectorVisible}
							onPromptChange={onPromptChange}
							onPromptKeyDown={onPromptKeyDown}
							onPromptSubmit={onPromptSubmit}
							onModeChange={onModeChange}
							onWorkdirChange={onWorkdirChange}
							onGoalModeChange={onGoalModeChange}
							onInterrupt={onInterrupt}
							onResume={onResume}
							onFork={onFork}
							onCompact={onCompact}
							onArchive={onArchive}
							onListBackgroundTerminals={onListBackgroundTerminals}
							onCleanBackgroundTerminals={onCleanBackgroundTerminals}
							onToggleNavigator={toggleNavigator}
							onToggleInspector={toggleInspector}
						/>
					</div>

					<AnimatePresence initial={false}>
						{inspectorVisible ? (
							<motion.div
								key="desktop-inspector"
								className="h-full min-h-0 shrink-0 overflow-hidden"
								initial={{ width: 0, opacity: 0 }}
								animate={{ width: 316, opacity: 1 }}
								exit={{ width: 0, opacity: 0 }}
								transition={spring}
							>
								{inspector}
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>
			) : null}

			{renderMobileShell ? (
				<div className="h-full min-h-0 md:hidden">
					<Workspace
						ref={mobileWorkspaceRef}
						presentationMode="mobile"
						project={selectedProject}
						threadSummary={threadSummary}
						detail={detail}
						selectedThread={selectedThread}
						selectedThreadId={selectedThreadId}
						workdir={workdir}
						busy={busy}
						busyAction={busyAction}
						notice={notice}
						onDismissNotice={onDismissNotice}
						error={error}
						onDismissError={onDismissError}
						prompt={prompt}
						promptTarget={promptTarget}
						goalMode={goalMode}
						canUseGoalMode={canUseGoalMode}
						canSubmitPrompt={canSubmitPrompt}
						wrapThreadContent={wrapThreadContent}
						displayScale={displayScale}
						navigatorVisible={mobileSheet === "navigator"}
						inspectorVisible={mobileSheet === "inspector"}
						onPromptChange={onPromptChange}
						onPromptKeyDown={onPromptKeyDown}
						onPromptSubmit={onPromptSubmit}
						onModeChange={onModeChange}
						onWorkdirChange={onWorkdirChange}
						onGoalModeChange={onGoalModeChange}
						onInterrupt={onInterrupt}
						onResume={onResume}
						onFork={onFork}
						onCompact={onCompact}
						onArchive={onArchive}
						onListBackgroundTerminals={onListBackgroundTerminals}
						onCleanBackgroundTerminals={onCleanBackgroundTerminals}
						onToggleNavigator={() => openMobileSheet("navigator")}
						onToggleInspector={() => openMobileSheet("inspector")}
						onOpenCommands={() => openCommandPalette()}
						onSwipeUp={openCommandPaletteFromSwipe}
					/>
				</div>
			) : null}

			<AnimatePresence>
				{renderMobileShell && mobileSheet ? (
					<motion.div
						className={cn("fixed inset-0 z-[120] md:hidden", ui.overlay)}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={spring}
						onMouseDown={() => closeMobileSheet()}
					>
						<motion.div
							ref={mobileSheetPanelRef}
							className={cn(mobileSheetClass, ui.backdropPanel)}
							tabIndex={-1}
							role="dialog"
							aria-modal="true"
							aria-label={
								mobileSheet === "navigator" ? "Thread navigator" : "Settings"
							}
							initial={{ y: "100%", opacity: 0 }}
							animate={{ y: 0, opacity: 1 }}
							exit={{ y: "100%", opacity: 0 }}
							transition={spring}
							drag="y"
							dragControls={mobileSheetDragControls}
							dragListener={false}
							dragConstraints={{ top: 0, bottom: 0 }}
							dragElastic={{ top: 0, bottom: 0.4 }}
							dragMomentum={false}
							onDragEnd={(_event, info) => {
								if (
									info.offset.y > dragDismissThreshold ||
									info.velocity.y > 600
								) {
									closeMobileSheet();
								}
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									closeMobileSheet();
									return;
								}
								cycleDialogFocus(event, mobileSheetPanelRef.current);
							}}
							onMouseDown={(event) => event.stopPropagation()}
						>
							<MobileSheetHandle
								onPointerDown={(event) => {
									startSheetDrag(event, mobileSheetDragControls);
								}}
							/>
							{mobileSheet === "navigator" ? (
								<Sidebar
									className="shadow-none"
									projects={projects}
									selectedProjectId={selectedProjectId}
									selectedThreadKey={selectedThreadKey}
									threadQuery={threadQuery}
									onProjectChange={onProjectChange}
									onThreadQueryChange={onThreadQueryChange}
									onSelectThread={(nextThread) => {
										onSelectThread(nextThread);
										closeMobileSheet({ restoreFocus: false });
									}}
									onCreateThread={() => {
										createThreadAndFocusPrompt();
										closeMobileSheet({ restoreFocus: false });
									}}
								/>
							) : (
								<ParamPanel
									className="shadow-none"
									threadSummary={threadSummary}
									detail={detail}
									selectedThread={selectedThread}
									wrapThreadContent={wrapThreadContent}
									themeMode={themeMode}
									displayScale={displayScale}
									onDisplayScaleChange={onDisplayScaleChange}
									defaultCwd={defaultCwd}
									onWrapThreadContentChange={onWrapThreadContentChange}
									onThemeModeChange={onThemeModeChange}
									pwa={pwa}
									fullscreenSupported={fullscreenSupported}
									isFullscreen={isFullscreen}
									onToggleFullscreen={toggleFullscreen}
									onThreadTagScoreChange={onThreadTagScoreChange}
									restartCodexAppServerDisabled={busy}
									onRestartCodexAppServer={onRestartCodexAppServer}
								/>
							)}
						</motion.div>
					</motion.div>
				) : null}
			</AnimatePresence>

			<CommandPalette
				open={commandOpen}
				actions={commandActions}
				autoFocusInput={commandAutoFocusInput}
				onClose={closeCommandPalette}
			/>
		</main>
	);
});
