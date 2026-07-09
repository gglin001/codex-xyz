import { AnimatePresence, motion } from "framer-motion";
import {
	Goal,
	Maximize2,
	Menu,
	RefreshCw,
	Search,
	Settings,
	Sun,
	Terminal,
	TextCursorInput,
	WrapText,
	ZoomIn,
} from "lucide-react";
import type { KeyboardEvent, SubmitEvent } from "react";
import {
	memo,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ControlThread,
	ThreadDetail,
	ThreadTagScore,
} from "../../server/domain.js";
import {
	cn,
	displayScale as displayScaleConfig,
	formatDisplayScale,
	layer,
	motionPresets,
	motionStates,
	ui,
} from "../designSystem.js";
import { isPromptFocusShortcut } from "../promptShortcut.js";
import { useShellPanelShortcuts } from "../shellShortcuts.js";
import { nextThemeMode, type ThemeMode, themeModeLabels } from "../theme.js";
import type { DateTimeFormatMode } from "../uiFormat.js";
import { useFullscreen } from "../useFullscreen.js";
import { useMobileLongPressSelectionGuard } from "../useMobileLongPressSelectionGuard.js";
import { useMobileTouchScrollBoundary } from "../useMobileTouchScrollBoundary.js";
import { useMobileViewportGeometry } from "../useMobileViewportGeometry.js";
import { MobileFloatingScroller } from "./MobileFloatingScroller.js";
import { ParamPanel } from "./ParamPanel.js";
import { Sidebar } from "./Sidebar.js";
import {
	FieldShell,
	MenuItemButton,
	ScrollableText,
	SurfaceAction,
} from "./uiPrimitives.js";
import { Workspace, type WorkspaceHandle } from "./Workspace.js";
import type {
	ComposerMode,
	SubmittedPromptFocusTarget,
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
	defaultModel: string | null;
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
	submittedPromptFocusTarget: SubmittedPromptFocusTarget | null;
	onNavigatorVisibleChange: (visible: boolean) => void;
	onInspectorVisibleChange: (visible: boolean) => void;
	onWrapThreadContentChange: (value: boolean) => void;
	onThemeModeChange: (mode: ThemeMode) => void;
	displayScale: number;
	onDisplayScaleChange: (value: number) => void;
	onThreadTagScoreChange: (value: ThreadTagScore | null) => void;
	onProjectChange: (projectId: string) => void;
	onSelectThread: (threadSummary: WorkbenchThread) => void;
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
	dateTimeFormatMode?: DateTimeFormatMode;
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
	  });

type MobileSheet = "navigator" | "inspector";

const overlayMotion = motionStates.overlay;
const mobileSheetMotion = motionStates.mobileSheet;
const desktopPopoverMotion = motionStates.desktopPopover;
const mobileViewportQuery = "(max-width: 767px)";

function isMobileViewport() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia(mobileViewportQuery).matches
	);
}

type ResponsiveViewportMode = "desktop" | "mobile";
const mobileAppBaseHistoryKey = "__cozMobileAppBase";
const mobileAppGuardHistoryKey = "__cozMobileAppGuard";
const mobileThreadOverlayHistoryKey = "__cozMobileThreadOverlay";

function currentHistoryStateRecord() {
	const current = window.history.state;
	return current && typeof current === "object" && !Array.isArray(current)
		? (current as Record<string, unknown>)
		: {};
}

function mobileHistoryState({
	base,
	guard,
	overlay,
}: {
	base?: boolean;
	guard?: boolean;
	overlay?: boolean;
}) {
	const next = { ...currentHistoryStateRecord() };
	if (base) {
		next[mobileAppBaseHistoryKey] = true;
	} else {
		delete next[mobileAppBaseHistoryKey];
	}
	if (guard) {
		next[mobileAppGuardHistoryKey] = true;
	} else {
		delete next[mobileAppGuardHistoryKey];
	}
	if (overlay) {
		next[mobileThreadOverlayHistoryKey] = true;
	} else {
		delete next[mobileThreadOverlayHistoryKey];
	}
	return next;
}

function mobileAppBaseHistoryState() {
	return mobileHistoryState({ base: true });
}

function mobileThreadMainHistoryState() {
	return mobileHistoryState({ guard: true });
}

function mobileThreadOverlayHistoryState() {
	return mobileHistoryState({ guard: true, overlay: true });
}

function ensureMobileAppGuardHistoryEntry() {
	if (mobileAppGuardActive(window.history.state)) {
		return;
	}
	window.history.replaceState(
		mobileAppBaseHistoryState(),
		"",
		window.location.href,
	);
	window.history.pushState(
		mobileThreadMainHistoryState(),
		"",
		window.location.href,
	);
}

function hasMobileAppBaseHistoryMarker(state: unknown) {
	return (
		Boolean(state) &&
		typeof state === "object" &&
		(state as Record<string, unknown>)[mobileAppBaseHistoryKey] === true
	);
}

function hasMobileAppGuardHistoryMarker(state: unknown) {
	return (
		Boolean(state) &&
		typeof state === "object" &&
		(state as Record<string, unknown>)[mobileAppGuardHistoryKey] === true
	);
}

function mobileAppGuardActive(state: unknown) {
	return (
		hasMobileAppGuardHistoryMarker(state) ||
		hasMobileThreadOverlayHistoryMarker(state)
	);
}

function hasMobileThreadOverlayHistoryMarker(state: unknown) {
	return (
		Boolean(state) &&
		typeof state === "object" &&
		(state as Record<string, unknown>)[mobileThreadOverlayHistoryKey] === true
	);
}

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

function commandActionMatches(action: CommandAction, normalizedQuery: string) {
	const searchable = `${action.name} ${action.detail}`;
	return searchable.toLowerCase().includes(normalizedQuery);
}

function commandParentId(action: CommandAction) {
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

function CommandActionGlyph({ action }: { action: CommandAction }) {
	if (action.kind === "settingsGroup") {
		return (
			<span
				className="relative flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				<span className={cn("h-8 w-8 text-muted-strong", ui.iconBox)}>
					<Settings size={14} />
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
				className="flex h-8 w-8 shrink-0 items-center justify-center"
				aria-hidden="true"
			>
				<span className={cn("h-8 w-8 text-muted-strong", ui.iconBox)}>
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
	const listId = useId();

	const filteredActions = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return filterCommandActions(actions, normalized);
	}, [actions, query]);

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
						"fixed inset-x-0 bottom-0 top-[var(--mobile-sheet-top)] flex items-start justify-center md:inset-0 md:px-3 md:pt-3",
						layer.overlayZ,
						ui.overlay,
					)}
					initial={overlayMotion.initial}
					animate={overlayMotion.animate}
					exit={overlayMotion.exit}
					transition={motionPresets.fade}
					onMouseDown={() => onClose()}
				>
					<motion.div
						ref={panelRef}
						className={cn(
							layer.mobileSheet,
							"px-0 md:static md:h-auto md:max-h-[min(44rem,calc(100dvh_-_1.5rem))] md:w-[44rem] md:max-w-[calc(100vw_-_1.5rem)] md:rounded-[12px]",
							ui.popover,
						)}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-label="Command palette"
						initial={
							isMobileViewport()
								? mobileSheetMotion.initial
								: desktopPopoverMotion.initial
						}
						animate={
							isMobileViewport()
								? mobileSheetMotion.animate
								: desktopPopoverMotion.animate
						}
						exit={
							isMobileViewport()
								? mobileSheetMotion.exit
								: desktopPopoverMotion.exit
						}
						transition={
							isMobileViewport() ? motionPresets.sheet : motionPresets.quick
						}
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
						<div
							className={cn(
								"flex shrink-0 items-center gap-1.5 px-2 pb-1 pt-0.5",
								ui.panelBand,
							)}
						>
							<div className="min-w-0 flex-1">
								<FieldShell icon={<Search size={14} />} className="h-8 w-full">
									<input
										type="search"
										ref={inputRef}
										className={cn(ui.input, ui.inputTextCompact)}
										value={query}
										onChange={(event) => {
											setQuery(event.target.value);
											setActiveIndex(0);
										}}
										placeholder="Search commands"
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
													return Math.min(
														filteredActions.length - 1,
														index + 1,
													);
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
						</div>
						<div className="relative min-h-0 flex-1">
							<div
								id={listId}
								ref={listRef}
								className="custom-scroll-host mobile-custom-scroll mobile-keyboard-scroll h-full min-h-0 touch-pan-y overflow-x-hidden overflow-y-auto px-1.5 py-1 md:max-h-[min(39rem,calc(100dvh_-_5rem))]"
							>
								{filteredActions.length === 0 ? (
									<div className="px-3 py-8 text-center text-[13px] text-muted">
										No commands found
									</div>
								) : null}
								{filteredActions.map((action, index) => (
									<MenuItemButton
										key={action.id}
										data-command-index={index}
										className={cn(
											"h-10 w-full gap-2.5 px-2.5",
											action.kind === "settingsItem" ? "pl-8" : null,
											action.disabled ? "opacity-45" : null,
										)}
										title={action.detail}
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
										<CommandActionGlyph action={action} />
										<span className="min-w-0 flex-1">
											<ScrollableText
												className="block text-[13px] font-medium"
												mobileStatic
											>
												{action.name}
											</ScrollableText>
											<ScrollableText
												className="block text-[11px] text-muted"
												mobileStatic
											>
												{action.disabled
													? (action.disabledDetail ?? action.detail)
													: action.detail}
											</ScrollableText>
										</span>
									</MenuItemButton>
								))}
							</div>
							<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-top" />
							<div className="chrome-edge-fade chrome-edge-fade-short chrome-edge-fade-panel chrome-edge-fade-bottom" />
							<MobileFloatingScroller
								scrollRef={listRef}
								scrollElementId={listId}
								contentRightInset="0.375rem"
							/>
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
	defaultModel,
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
	submittedPromptFocusTarget,
	onNavigatorVisibleChange,
	onInspectorVisibleChange,
	onWrapThreadContentChange,
	onThemeModeChange,
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
	dateTimeFormatMode = "utc",
}: DashboardLayoutProps) {
	const [mobileSheet, setMobileSheet] = useState<MobileSheet | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandAutoFocusInput, setCommandAutoFocusInput] = useState(true);
	const desktopWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const mobileWorkspaceRef = useRef<WorkspaceHandle | null>(null);
	const commandReturnFocusRef = useRef<HTMLElement | null>(null);
	const mobileSheetReturnFocusRef = useRef<HTMLElement | null>(null);
	const mobileSheetPanelRef = useRef<HTMLDivElement | null>(null);
	const mobileThreadOverlayHistoryPushedRef = useRef(false);
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
	useMobileLongPressSelectionGuard();
	useMobileTouchScrollBoundary(mobileSheetPanelRef, mobileSheet !== null, {
		strictVertical: mobileSheet === "inspector",
	});

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
			if (isMobileViewport()) {
				onTerminalVisibleChange(false);
			}
			setCommandOpen(true);
		},
		[closeMobileSheet, onTerminalVisibleChange],
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

	const toggleCommandPalette = useCallback(() => {
		if (commandOpen) {
			closeCommandPalette();
			return;
		}
		openCommandPalette();
	}, [closeCommandPalette, commandOpen, openCommandPalette]);

	const toggleTerminal = useCallback(() => {
		if (terminalVisible) {
			onTerminalVisibleChange(false);
			return;
		}
		if (isMobileViewport()) {
			closeCommandPalette({ restoreFocus: false });
			closeMobileSheet({ restoreFocus: false });
			blurActiveElement();
		}
		onTerminalVisibleChange(true);
	}, [
		closeCommandPalette,
		closeMobileSheet,
		onTerminalVisibleChange,
		terminalVisible,
	]);

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

	useShellPanelShortcuts({
		onToggleNavigator: toggleNavigator,
		onToggleInspector: toggleInspector,
	});

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

	useEffect(() => {
		if (viewportMode !== "mobile") {
			return;
		}
		ensureMobileAppGuardHistoryEntry();
	}, [viewportMode]);

	useEffect(() => {
		const mobileThreadOverlayOpen =
			commandOpen || mobileSheet !== null || terminalVisible;
		if (viewportMode !== "mobile") {
			mobileThreadOverlayHistoryPushedRef.current = false;
			return;
		}
		if (mobileThreadOverlayOpen) {
			if (!hasMobileThreadOverlayHistoryMarker(window.history.state)) {
				window.history.pushState(
					mobileThreadOverlayHistoryState(),
					"",
					window.location.href,
				);
			}
			mobileThreadOverlayHistoryPushedRef.current = true;
			return;
		}

		if (!hasMobileThreadOverlayHistoryMarker(window.history.state)) {
			mobileThreadOverlayHistoryPushedRef.current = false;
			return;
		}

		if (mobileThreadOverlayHistoryPushedRef.current) {
			mobileThreadOverlayHistoryPushedRef.current = false;
			window.history.back();
			return;
		}

		window.history.replaceState(
			mobileThreadMainHistoryState(),
			"",
			window.location.href,
		);
	}, [commandOpen, mobileSheet, terminalVisible, viewportMode]);

	useEffect(() => {
		const closeMobileThreadOverlaysForHistory = () => {
			mobileThreadOverlayHistoryPushedRef.current = false;
			if (!commandOpen && !mobileSheet && !terminalVisible) {
				return;
			}
			setCommandOpen(false);
			commandReturnFocusRef.current = null;
			mobileSheetReturnFocusRef.current = null;
			blurActiveElement();
			onTerminalVisibleChange(false);
			setMobileSheet(null);
		};

		const handleMobilePopState = (event: PopStateEvent) => {
			if (!isMobileViewport()) {
				return;
			}
			if (hasMobileAppBaseHistoryMarker(event.state)) {
				ensureMobileAppGuardHistoryEntry();
				closeMobileThreadOverlaysForHistory();
				return;
			}
			closeMobileThreadOverlaysForHistory();
		};

		window.addEventListener("popstate", handleMobilePopState);
		return () => {
			window.removeEventListener("popstate", handleMobilePopState);
		};
	}, [commandOpen, mobileSheet, onTerminalVisibleChange, terminalVisible]);

	const commandActions = useMemo<CommandAction[]>(() => {
		const focusPrompt = () => {
			closeMobileSheet({ restoreFocus: false });
			window.requestAnimationFrame(focusVisiblePrompt);
		};
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
				run: toggleNavigator,
			},
			{
				id: "open-terminal",
				name: "Terminal",
				detail: "Toggle the terminal dock",
				kind: "terminal",
				run: toggleTerminal,
			},
			{
				id: "settings:panel",
				name: "Settings",
				detail: isMobileViewport()
					? "Open settings and transcript controls"
					: "Toggle settings and transcript controls",
				kind: "settingsGroup",
				settingsGroupId: "panel",
				run: toggleInspector,
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
		];

		return actions;
	}, [
		busy,
		displayScale,
		focusVisiblePrompt,
		fullscreenSupported,
		themeMode,
		toggleInspector,
		toggleFullscreen,
		toggleNavigator,
		wrapThreadContent,
		onDisplayScaleChange,
		onThemeModeChange,
		onWrapThreadContentChange,
		closeMobileSheet,
		onRestartCodexAppServer,
		toggleTerminal,
	]);

	const sidebarFooter = (
		<div className={cn("shrink-0 px-2 pb-1.5 pt-0.5", ui.panelBand)}>
			<div className="grid grid-cols-2 gap-1.5">
				<SurfaceAction
					className={cn(
						"h-9 justify-center gap-2 px-2 text-[12px] font-medium",
						terminalVisible ? null : "text-muted-strong",
					)}
					title="Toggle terminal"
					aria-label="Toggle terminal"
					selected={terminalVisible}
					onClick={toggleTerminal}
				>
					<Terminal size={14} />
					<span className="truncate">Terminal</span>
				</SurfaceAction>
				<SurfaceAction
					className={cn(
						"h-9 justify-center gap-2 px-2 text-[12px] font-medium",
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
			dateTimeFormatMode={dateTimeFormatMode}
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
			defaultModel={defaultModel}
			workdir={workdir}
			promptTarget={promptTarget}
			onWrapThreadContentChange={onWrapThreadContentChange}
			onThemeModeChange={onThemeModeChange}
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
								transition={motionPresets.panel}
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
							submittedPromptFocusTarget={submittedPromptFocusTarget}
							wrapThreadContent={wrapThreadContent}
							displayScale={displayScale}
							commandVisible={commandOpen}
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
							onOpenCommands={toggleCommandPalette}
							dateTimeFormatMode={dateTimeFormatMode}
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
								transition={motionPresets.panel}
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
						submittedPromptFocusTarget={submittedPromptFocusTarget}
						wrapThreadContent={wrapThreadContent}
						displayScale={displayScale}
						commandVisible={commandOpen}
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
						onOpenCommands={toggleCommandPalette}
						dateTimeFormatMode={dateTimeFormatMode}
					/>
				</div>
			) : null}

			<AnimatePresence>
				{renderMobileShell && mobileSheet ? (
					<motion.div
						className={cn(
							"mobile-sheet-overlay fixed inset-x-0 bottom-0 top-[var(--mobile-sheet-top)] md:hidden",
							layer.overlayZ,
							ui.overlay,
						)}
						initial={overlayMotion.initial}
						animate={overlayMotion.animate}
						exit={overlayMotion.exit}
						transition={motionPresets.fade}
						onMouseDown={() => closeMobileSheet()}
					>
						<motion.div
							ref={mobileSheetPanelRef}
							className={cn(
								layer.mobileSheet,
								mobileSheet === "inspector"
									? "mobile-stable-settings-sheet"
									: null,
								ui.backdropPanel,
							)}
							tabIndex={-1}
							role="dialog"
							aria-modal="true"
							aria-label={
								mobileSheet === "navigator" ? "Thread navigator" : "Settings"
							}
							initial={mobileSheetMotion.initial}
							animate={mobileSheetMotion.animate}
							exit={mobileSheetMotion.exit}
							transition={motionPresets.sheet}
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
									dateTimeFormatMode={dateTimeFormatMode}
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
									defaultModel={defaultModel}
									workdir={workdir}
									promptTarget={promptTarget}
									onWrapThreadContentChange={onWrapThreadContentChange}
									onThemeModeChange={onThemeModeChange}
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
