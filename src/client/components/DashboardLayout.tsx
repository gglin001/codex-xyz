import { AnimatePresence, motion } from "framer-motion";
import {
	Goal,
	Maximize2,
	Menu,
	Plus,
	Search,
	Settings,
	Sun,
	Terminal,
	TextCursorInput,
	WrapText,
	ZoomIn,
} from "lucide-react";
import type { KeyboardEvent, SubmitEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ControlThread,
	SessionDisplayStatus,
	ThreadDetail,
} from "../../server/domain.js";
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
import { useSwipeGesture } from "../useSwipeGesture.js";
import { ParamPanel } from "./ParamPanel.js";
import { Sidebar } from "./Sidebar.js";
import { SessionStatusIcon } from "./sessionStatusIcon.js";
import { AvatarBadge, MenuItemButton, SurfaceAction } from "./uiPrimitives.js";
import { Workspace, type WorkspaceHandle } from "./Workspace.js";
import type {
	ComposerMode,
	WorkbenchProject,
	WorkbenchSession,
} from "./workbenchTypes.js";

export type DashboardLayoutProps = {
	projects: WorkbenchProject[];
	selectedProjectId: string;
	selectedSessionId: string | null;
	session: WorkbenchSession | null;
	detail: ThreadDetail | null;
	selectedThread: ControlThread | null;
	selectedThreadId: string | null;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	terminalVisible: boolean;
	wrapSessionContent: boolean;
	themeMode: ThemeMode;
	sessionQuery: string;
	defaultCwd: string;
	workdir: string;
	busy: boolean;
	busyAction: string | null;
	notice: string | null;
	error: string | null;
	prompt: string;
	promptTarget: ComposerMode;
	goalMode: boolean;
	canUseGoalMode: boolean;
	canSubmitPrompt: boolean;
	onNavigatorVisibleChange: (visible: boolean) => void;
	onInspectorVisibleChange: (visible: boolean) => void;
	onWrapSessionContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	displayScale: number;
	onDisplayScaleChange: (value: number) => void;
	onProjectChange: (projectId: string) => void;
	onSelectSession: (
		session: WorkbenchSession,
		options?: { clearSessionQuery?: boolean },
	) => void;
	onCreateSession: () => void;
	onSessionQueryChange: (value: string) => void;
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
};

type CommandActionBase = {
	id: string;
	title: string;
	detail: string;
	run: () => void;
	disabled?: boolean;
	disabledDetail?: string;
};

type CommandAction =
	| (CommandActionBase & {
			kind: "create" | "navigator" | "terminal" | "prompt" | "view";
	  })
	| (CommandActionBase & {
			kind: "project";
			projectId: string;
			projectInitials: string;
	  })
	| (CommandActionBase & {
			kind: "session";
			projectId: string;
			status: SessionDisplayStatus;
	  })
	| (CommandActionBase & {
			kind: "settingsGroup";
			settingsGroupId: string;
	  })
	| (CommandActionBase & {
			kind: "settingsItem";
			settingsGroupId: string;
			icon: "fullscreen" | "goal" | "settings" | "theme" | "wrap" | "zoom";
	  });

type CommandActionRenderItem = {
	action: CommandAction;
	parentHasVisibleChildren: boolean;
	lastVisibleChild: boolean;
};

type MobileSheet = "navigator" | "inspector";

const spring = { type: "spring", stiffness: 360, damping: 36 } as const;
const dragDismissThreshold = 80;
const mobileSheetClass =
	"mobile-sheet-surface absolute inset-x-0 top-[var(--mobile-sheet-top)] flex h-[var(--mobile-sheet-height)] flex-col overflow-hidden rounded-t-[16px] border-t";

function isMobileViewport() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(max-width: 767px)").matches
	);
}

function blurActiveElement() {
	const activeElement = document.activeElement;
	if (activeElement instanceof HTMLElement) {
		activeElement.blur();
	}
}

function MobileSheetHandle() {
	return (
		<div
			className="pointer-events-none flex h-7 shrink-0 items-start justify-center pt-2"
			aria-hidden="true"
		>
			<span className="h-1 w-10 rounded-full bg-border-strong" />
		</div>
	);
}

function commandActionMatches(action: CommandAction, normalizedQuery: string) {
	return `${action.title} ${action.detail}`
		.toLowerCase()
		.includes(normalizedQuery);
}

function commandParentId(action: CommandAction) {
	if (action.kind === "session") {
		return `project:${action.projectId}`;
	}
	if (action.kind === "settingsItem") {
		return `settings:${action.settingsGroupId}`;
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

	const seenChildren = new Map<string, number>();
	return actions.map((action) => {
		const parentId = commandParentId(action);
		if (!parentId) {
			return {
				action,
				parentHasVisibleChildren: (visibleChildCounts.get(action.id) ?? 0) > 0,
				lastVisibleChild: false,
			};
		}

		const nextIndex = (seenChildren.get(parentId) ?? 0) + 1;
		seenChildren.set(parentId, nextIndex);
		return {
			action,
			parentHasVisibleChildren: false,
			lastVisibleChild: nextIndex === (visibleChildCounts.get(parentId) ?? 0),
		};
	});
}

function CommandActionGlyph({
	action,
	parentHasVisibleChildren,
	lastVisibleChild,
}: CommandActionRenderItem) {
	if (action.kind === "project") {
		return (
			<span
				className="relative flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				{parentHasVisibleChildren ? (
					<span className="absolute left-4 top-8 h-2 border-l border-border" />
				) : null}
				<AvatarBadge className="h-8 w-8 text-[11px]">
					{action.projectInitials}
				</AvatarBadge>
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
					<span className="absolute left-4 top-8 h-2 border-l border-border" />
				) : null}
				<span
					className={cn(
						"h-8 w-8 border border-border text-muted-strong",
						ui.iconBox,
					)}
				>
					<Settings size={14} />
				</span>
			</span>
		);
	}

	if (action.kind === "session") {
		return (
			<span
				className="relative flex h-8 w-12 shrink-0 items-center"
				aria-hidden="true"
			>
				<span
					className={cn(
						"absolute left-2 border-l border-border",
						lastVisibleChild ? "-top-2 h-6" : "-top-2 -bottom-2",
					)}
				/>
				<span className="absolute left-2 top-4 w-3 border-t border-border" />
				<span
					className={cn(
						"absolute right-0 top-0 h-8 w-8 border border-border text-muted-strong",
						ui.iconBox,
					)}
				>
					<SessionStatusIcon status={action.status} />
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
			) : (
				<Settings size={14} />
			);
		return (
			<span
				className="relative flex h-8 w-12 shrink-0 items-center"
				aria-hidden="true"
			>
				<span
					className={cn(
						"absolute left-2 border-l border-border",
						lastVisibleChild ? "-top-2 h-6" : "-top-2 -bottom-2",
					)}
				/>
				<span className="absolute left-2 top-4 w-3 border-t border-border" />
				<span
					className={cn(
						"absolute right-0 top-0 h-8 w-8 border border-border text-muted-strong",
						ui.iconBox,
					)}
				>
					{itemIcon}
				</span>
			</span>
		);
	}

	const icon =
		action.kind === "create" ? (
			<Plus size={14} />
		) : action.kind === "navigator" ? (
			<Menu size={14} />
		) : action.kind === "terminal" ? (
			<Terminal size={14} />
		) : action.kind === "prompt" ? (
			<TextCursorInput size={14} />
		) : (
			<WrapText size={14} />
		);

	return (
		<span
			className={cn(
				"h-8 w-8 border border-border text-muted-strong",
				ui.iconBox,
			)}
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
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const paletteRef = useRef<HTMLDivElement | null>(null);

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
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			inputRef.current?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [autoFocusInput, open]);

	const runActive = useCallback(() => {
		const action = filteredActions[activeIndex];
		if (!action || action.disabled) {
			return;
		}
		action.run();
		onClose();
	}, [activeIndex, filteredActions, onClose]);

	useSwipeGesture(paletteRef, {
		onSwipeDown: onClose,
	});

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
					onMouseDown={onClose}
				>
					<motion.div
						ref={paletteRef}
						className={cn(
							mobileSheetClass,
							"px-0 md:static md:h-auto md:max-h-[min(40rem,calc(100dvh_-_7rem))] md:w-[44rem] md:max-w-[calc(100vw_-_2rem)] md:rounded-[12px] md:border",
							ui.popover,
						)}
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
						onMouseDown={(event) => event.stopPropagation()}
					>
						<div className="md:hidden">
							<MobileSheetHandle />
						</div>
						<div className="flex h-12 items-center gap-3 border-b border-border px-3.5">
							<Search size={16} className="text-muted" />
							<input
								ref={inputRef}
								className={cn(ui.input, "h-10 text-[14px]")}
								value={query}
								onChange={(event) => {
									setQuery(event.target.value);
									setActiveIndex(0);
								}}
								placeholder="Search Anything"
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										onClose();
									}
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setActiveIndex((index) =>
											Math.min(filteredActions.length - 1, index + 1),
										);
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
						</div>
						<div className="mobile-keyboard-scroll min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[min(31rem,calc(100dvh_-_12rem))]">
							{filteredActions.length === 0 ? (
								<div className="px-3 py-8 text-center text-[13px] text-muted">
									No commands found
								</div>
							) : null}
							{renderItems.map(
								(
									{ action, parentHasVisibleChildren, lastVisibleChild },
									index,
								) => (
									<MenuItemButton
										key={action.id}
										className={cn(
											"h-11 w-full gap-2.5 px-2.5",
											index === activeIndex ? null : "bg-transparent",
											action.disabled ? "opacity-45" : null,
										)}
										selected={index === activeIndex}
										disabled={action.disabled}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => {
											if (action.disabled) {
												return;
											}
											action.run();
											onClose();
										}}
									>
										<CommandActionGlyph
											action={action}
											parentHasVisibleChildren={parentHasVisibleChildren}
											lastVisibleChild={lastVisibleChild}
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[13px] font-medium">
												{action.title}
											</span>
											<span className="block truncate text-[11px] text-muted">
												{action.disabled
													? (action.disabledDetail ?? action.detail)
													: action.detail}
											</span>
										</span>
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
	selectedSessionId,
	session,
	detail,
	selectedThread,
	selectedThreadId,
	navigatorVisible,
	inspectorVisible,
	terminalVisible,
	wrapSessionContent,
	themeMode,
	sessionQuery,
	defaultCwd,
	workdir,
	busy,
	busyAction,
	notice,
	error,
	prompt,
	promptTarget,
	goalMode,
	canUseGoalMode,
	canSubmitPrompt,
	onNavigatorVisibleChange,
	onInspectorVisibleChange,
	onWrapSessionContentChange,
	onThemeModeChange,
	displayScale,
	onDisplayScaleChange,
	onProjectChange,
	onSelectSession,
	onCreateSession,
	onSessionQueryChange,
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
}: DashboardLayoutProps) {
	const [mobileSheet, setMobileSheet] = useState<MobileSheet | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandAutoFocusInput, setCommandAutoFocusInput] = useState(true);
	const desktopWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const mobileWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const mobileSheetRef = useRef<HTMLDivElement | null>(null);
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

	const createSessionAndFocusPrompt = useCallback(() => {
		onCreateSession();
		window.requestAnimationFrame(focusVisiblePrompt);
	}, [focusVisiblePrompt, onCreateSession]);

	const openCommandPalette = useCallback(
		(options?: { autoFocusInput?: boolean }) => {
			const autoFocusInput = options?.autoFocusInput ?? !isMobileViewport();
			setCommandAutoFocusInput(autoFocusInput);
			if (!autoFocusInput) {
				blurActiveElement();
			}
			setMobileSheet(null);
			setCommandOpen(true);
		},
		[],
	);

	const openCommandPaletteFromSwipe = useCallback(() => {
		openCommandPalette({ autoFocusInput: false });
	}, [openCommandPalette]);

	const toggleCommandPalette = useCallback(() => {
		const opening = !commandOpen;
		if (opening) {
			const autoFocusInput = !isMobileViewport();
			setCommandAutoFocusInput(autoFocusInput);
			if (!autoFocusInput) {
				blurActiveElement();
			}
		}
		setMobileSheet(null);
		setCommandOpen(opening);
	}, [commandOpen]);

	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				setCommandOpen(false);
				setMobileSheet(null);
				return;
			}
			if (!commandOpen && isPromptFocusShortcut(event)) {
				event.preventDefault();
				setMobileSheet(null);
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
	}, [commandOpen, focusVisiblePrompt, toggleCommandPalette]);

	useEffect(() => {
		if (terminalVisible) {
			setMobileSheet(null);
		}
	}, [terminalVisible]);

	const commandActions = useMemo<CommandAction[]>(() => {
		const setNavigatorVisible = () => {
			if (isMobileViewport()) {
				onTerminalVisibleChange(false);
				setMobileSheet((current) =>
					current === "navigator" ? null : "navigator",
				);
				return;
			}
			onNavigatorVisibleChange(!navigatorVisible);
		};
		const setInspectorVisible = () => {
			if (isMobileViewport()) {
				onTerminalVisibleChange(false);
				setMobileSheet((current) =>
					current === "inspector" ? null : "inspector",
				);
				return;
			}
			onInspectorVisibleChange(!inspectorVisible);
		};
		const showTerminal = () => {
			setMobileSheet(null);
			onTerminalVisibleChange(true);
		};
		const focusPrompt = () => {
			setMobileSheet(null);
			window.requestAnimationFrame(focusVisiblePrompt);
		};
		const actions: CommandAction[] = [
			{
				id: "create-session",
				title: "Create new session",
				detail: "Start a fresh Codex app-server session",
				kind: "create",
				run: createSessionAndFocusPrompt,
			},
			{
				id: "focus-prompt",
				title: "Focus prompt",
				detail: "Jump to the composer input",
				kind: "prompt",
				run: focusPrompt,
			},
			{
				id: "toggle-navigator",
				title: isMobileViewport()
					? "Open sessions"
					: navigatorVisible
						? "Hide sessions"
						: "Show sessions",
				detail: "Open the project and session list",
				kind: "navigator",
				run: setNavigatorVisible,
			},
			{
				id: "open-terminal",
				title: terminalVisible ? "Show terminal" : "Open terminal",
				detail: "Open the terminal dock",
				kind: "terminal",
				run: showTerminal,
			},
			{
				id: "settings:panel",
				title: "Settings",
				detail: isMobileViewport()
					? "Open settings and transcript controls"
					: "Toggle settings and transcript controls",
				kind: "settingsGroup",
				settingsGroupId: "panel",
				run: setInspectorVisible,
			},
			{
				id: "settings:toggle-goal-mode",
				title: goalMode ? "Disable goal mode" : "Enable goal mode",
				detail: goalMode
					? "Composer will send normal prompts"
					: "Composer will start or continue a goal",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "goal",
				disabled: !goalMode && !canUseGoalMode,
				disabledDetail:
					"Select a session or working directory before using goal mode",
				run: () => onGoalModeChange(!goalMode),
			},
			{
				id: "settings:toggle-theme",
				title: themeMode === "day" ? "Use dark mode" : "Use day mode",
				detail: `Current appearance ${themeModeLabels[themeMode]}`,
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "theme",
				run: () => onThemeModeChange(nextThemeMode(themeMode)),
			},
			{
				id: "settings:toggle-wrap",
				title: wrapSessionContent
					? "Disable transcript wrap"
					: "Enable transcript wrap",
				detail: wrapSessionContent
					? "Long transcript lines will scroll horizontally"
					: "Long transcript lines will wrap",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "wrap",
				run: () => onWrapSessionContentChange(!wrapSessionContent),
			},
			{
				id: "settings:reset-scale",
				title: "Reset content scale",
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
				title: isFullscreen ? "Exit full screen" : "Enter full screen",
				detail: "Use the whole browser viewport",
				kind: "settingsItem",
				settingsGroupId: "panel",
				icon: "fullscreen",
				disabled: !fullscreenSupported,
				disabledDetail: "Full screen is not available in this browser",
				run: toggleFullscreen,
			},
		];

		for (const project of projects) {
			actions.push({
				id: `project:${project.id}`,
				title: `Switch to ${project.name}`,
				detail: project.path,
				kind: "project",
				projectId: project.id,
				projectInitials: project.initials,
				run: () => onProjectChange(project.id),
			});
			for (const projectSession of project.sessions) {
				actions.push({
					id: `session:${projectSession.id}`,
					title: projectSession.title,
					detail: `${project.name} / ${projectSession.cwd}`,
					kind: "session",
					projectId: project.id,
					status: projectSession.status,
					run: () => {
						onSelectSession(projectSession, { clearSessionQuery: true });
					},
				});
			}
		}

		return actions;
	}, [
		canUseGoalMode,
		displayScale,
		focusVisiblePrompt,
		fullscreenSupported,
		goalMode,
		inspectorVisible,
		isFullscreen,
		navigatorVisible,
		terminalVisible,
		themeMode,
		toggleFullscreen,
		wrapSessionContent,
		createSessionAndFocusPrompt,
		onDisplayScaleChange,
		onGoalModeChange,
		onInspectorVisibleChange,
		onNavigatorVisibleChange,
		onThemeModeChange,
		onWrapSessionContentChange,
		onTerminalVisibleChange,
		onProjectChange,
		onSelectSession,
		projects,
	]);

	const toggleDesktopTerminal = useCallback(() => {
		onTerminalVisibleChange(!terminalVisible);
	}, [onTerminalVisibleChange, terminalVisible]);

	const openMobileSheet = useCallback(
		(sheet: MobileSheet) => {
			onTerminalVisibleChange(false);
			setMobileSheet((current) => (current === sheet ? null : sheet));
		},
		[onTerminalVisibleChange],
	);

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

	useSwipeGesture(mobileSheetRef, {
		onSwipeDown: () => setMobileSheet(null),
	});

	const sidebarFooter = (
		<div className="shrink-0 border-t border-border p-3">
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
			selectedSessionId={selectedSessionId}
			sessionQuery={sessionQuery}
			onProjectChange={onProjectChange}
			onSessionQueryChange={onSessionQueryChange}
			onSelectSession={onSelectSession}
			onCreateSession={createSessionAndFocusPrompt}
			footer={sidebarFooter}
		/>
	);

	const inspector = (
		<ParamPanel
			session={session}
			detail={detail}
			selectedThread={selectedThread}
			wrapSessionContent={wrapSessionContent}
			themeMode={themeMode}
			displayScale={displayScale}
			onDisplayScaleChange={onDisplayScaleChange}
			defaultCwd={defaultCwd}
			onWrapSessionContentChange={onWrapSessionContentChange}
			onThemeModeChange={onThemeModeChange}
			fullscreenSupported={fullscreenSupported}
			isFullscreen={isFullscreen}
			onToggleFullscreen={toggleFullscreen}
		/>
	);

	return (
		<main
			className={cn(
				"h-[var(--app-visual-height)] min-h-0 w-full overflow-hidden md:h-dvh",
				ui.appShell,
			)}
		>
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
						project={selectedProject}
						session={session}
						detail={detail}
						selectedThread={selectedThread}
						selectedThreadId={selectedThreadId}
						workdir={workdir}
						busy={busy}
						busyAction={busyAction}
						notice={notice}
						error={error}
						prompt={prompt}
						promptTarget={promptTarget}
						goalMode={goalMode}
						canUseGoalMode={canUseGoalMode}
						canSubmitPrompt={canSubmitPrompt}
						wrapSessionContent={wrapSessionContent}
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

			<div className="h-full min-h-0 md:hidden">
				<Workspace
					ref={mobileWorkspaceRef}
					project={selectedProject}
					session={session}
					detail={detail}
					selectedThread={selectedThread}
					selectedThreadId={selectedThreadId}
					workdir={workdir}
					busy={busy}
					busyAction={busyAction}
					notice={notice}
					error={error}
					prompt={prompt}
					promptTarget={promptTarget}
					goalMode={goalMode}
					canUseGoalMode={canUseGoalMode}
					canSubmitPrompt={canSubmitPrompt}
					wrapSessionContent={wrapSessionContent}
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
					onToggleNavigator={() => openMobileSheet("navigator")}
					onToggleInspector={() => openMobileSheet("inspector")}
					onSwipeUp={openCommandPaletteFromSwipe}
				/>
			</div>

			<AnimatePresence>
				{mobileSheet ? (
					<motion.div
						className={cn("fixed inset-0 z-[90] md:hidden", ui.overlay)}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={spring}
						onMouseDown={() => setMobileSheet(null)}
					>
						<motion.div
							ref={mobileSheetRef}
							className={cn(mobileSheetClass, ui.backdropPanel)}
							initial={{ y: "100%", opacity: 0 }}
							animate={{ y: 0, opacity: 1 }}
							exit={{ y: "100%", opacity: 0 }}
							transition={spring}
							drag="y"
							dragConstraints={{ top: 0, bottom: 0 }}
							dragElastic={{ top: 0, bottom: 0.4 }}
							dragMomentum={false}
							onDragEnd={(_event, info) => {
								if (
									info.offset.y > dragDismissThreshold ||
									info.velocity.y > 600
								) {
									setMobileSheet(null);
								}
							}}
							onMouseDown={(event) => event.stopPropagation()}
						>
							<MobileSheetHandle />
							{mobileSheet === "navigator" ? (
								<Sidebar
									className="border-r-0"
									projects={projects}
									selectedProjectId={selectedProjectId}
									selectedSessionId={selectedSessionId}
									sessionQuery={sessionQuery}
									onProjectChange={onProjectChange}
									onSessionQueryChange={onSessionQueryChange}
									onSelectSession={(nextSession) => {
										onSelectSession(nextSession);
										setMobileSheet(null);
									}}
									onCreateSession={() => {
										createSessionAndFocusPrompt();
										setMobileSheet(null);
									}}
								/>
							) : (
								<ParamPanel
									className="border-l-0"
									session={session}
									detail={detail}
									selectedThread={selectedThread}
									wrapSessionContent={wrapSessionContent}
									themeMode={themeMode}
									displayScale={displayScale}
									onDisplayScaleChange={onDisplayScaleChange}
									defaultCwd={defaultCwd}
									onWrapSessionContentChange={onWrapSessionContentChange}
									onThemeModeChange={onThemeModeChange}
									fullscreenSupported={fullscreenSupported}
									isFullscreen={isFullscreen}
									onToggleFullscreen={toggleFullscreen}
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
				onClose={() => setCommandOpen(false)}
			/>
		</main>
	);
});
