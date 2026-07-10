import { AnimatePresence, motion } from "framer-motion";
import {
	Bot,
	Check,
	Copy,
	Ellipsis,
	Goal,
	Menu,
	Plus,
	Search,
	Send,
	Settings,
	X,
} from "lucide-react";
import type {
	CSSProperties,
	KeyboardEvent,
	MouseEvent,
	ReactNode,
	SubmitEvent,
} from "react";
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ControlThread,
	ThreadDetail,
	ThreadDisplayStatus,
	ThreadItem,
} from "../../server/domain.js";
import { threadDisplayStatus } from "../../server/domain.js";
import { copyToClipboard } from "../clipboard.js";
import { codexThreadCommandLabels } from "../codexCommandLabels.js";
import {
	cn,
	layer,
	motionPresets,
	motionStates,
	tone,
	ui,
} from "../designSystem.js";
import {
	isOptimisticThreadId,
	isOptimisticTurnId,
} from "../optimisticThreads.js";
import { getFirstLineTextPreview } from "../textPreview.js";
import {
	getTranscriptEntries,
	type TranscriptEntry,
	type TranscriptProcessEntry,
} from "../transcriptEntries.js";
import {
	type DateTimeFormatMode,
	formatTime,
	formatTokens,
	itemTitle,
	statusLabel,
} from "../uiFormat.js";
import type { FloatingScrollAnchor } from "./MobileFloatingScroller.js";
import { ScrollArea } from "./ScrollArea.js";
import {
	CollapsibleCard,
	ComposerIconButton,
	CopyIconButton,
	FieldShell,
	LargeIconButton,
	MenuItemButton,
	ScrollableText,
} from "./uiPrimitives.js";
import type {
	ComposerMode,
	SubmittedPromptFocusTarget,
	WorkbenchProject,
	WorkbenchThread,
} from "./workbenchTypes.js";

export type WorkspaceProps = {
	presentationMode?: "desktop" | "mobile";
	project: WorkbenchProject | null;
	threadSummary: WorkbenchThread | null;
	detail: ThreadDetail | null;
	selectedThread: ControlThread | null;
	selectedThreadId: string | null;
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
	wrapThreadContent: boolean;
	loadingEarlierTranscript: boolean;
	displayScale: number;
	commandVisible: boolean;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	submittedPromptFocusTarget: SubmittedPromptFocusTarget | null;
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
	onLoadEarlierTranscript: () => Promise<unknown>;
	onToggleNavigator: () => void;
	onToggleInspector: () => void;
	onOpenCommands?: () => void;
	dateTimeFormatMode?: DateTimeFormatMode;
};

const useAutosizeLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

export type WorkspaceHandle = {
	focusPrompt: () => boolean;
};

type ComposerHandle = {
	focusPrompt: () => boolean;
};

type ComposerMenuAction = {
	id: string;
	label: string;
	detail: string;
	disabledReason: string | null;
	run: () => void;
};

type ChatMessage = {
	id: string;
	name: string;
	text: string;
	copyText: string;
	time: string;
};

const overlayMotion = motionStates.overlay;
const localMenuMotion = motionStates.localMenu;
const revealMotion = motionStates.reveal;
const transcriptItemMotion = {
	initial: { opacity: 1 },
	animate: { opacity: 1 },
	exit: { opacity: 1 },
} as const;
const threadContentFrameClass = "mx-auto w-full min-w-0 md:max-w-[72rem]";
const transcriptCardPaddingClass = "px-0";
const transcriptCardBodyPaddingClass = "px-0 pb-4 pt-1";
const transcriptProcessBodyPaddingClass =
	"grid gap-1.5 pl-[1ch] pr-0 pb-3 pt-0";
const transcriptCardPreviewPaddingClass = "px-0 pb-3";
const mobileTranscriptInitialWindow = 80;
const mobileTranscriptWindowStep = 80;

function ThreadContentFrame({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn(threadContentFrameClass, className)}>{children}</div>
	);
}

function messageFromItem(item: ThreadItem): ChatMessage {
	const fallbackText = item.text || "Pending...";
	return {
		id: item.id,
		name:
			item.data.localSubmissionError === true ? "Submission" : itemTitle(item),
		text: fallbackText,
		copyText: fallbackText,
		time: item.createdAt,
	};
}

function transcriptEntriesFromDetail(detail: ThreadDetail | null) {
	return detail ? getTranscriptEntries(detail.items) : [];
}

function transcriptEntryItemCount(entry: TranscriptEntry) {
	return entry.kind === "process" ? entry.items.length : 1;
}

function transcriptHiddenItemCount(entries: TranscriptEntry[]) {
	return entries.reduce(
		(total, entry) => total + transcriptEntryItemCount(entry),
		0,
	);
}

function transcriptItemDataAttributes(entry: TranscriptEntry) {
	return entry.kind === "item"
		? {
				"data-transcript-item-id": entry.item.id,
				tabIndex: -1,
			}
		: {};
}

function transcriptPromptAnchors(
	entries: TranscriptEntry[],
): FloatingScrollAnchor[] {
	let promptIndex = 0;
	return entries.flatMap((entry) => {
		if (entry.kind !== "item" || entry.item.type !== "user") {
			return [];
		}

		promptIndex += 1;
		const preview = getFirstLineTextPreview(entry.item.text.trim() || "Prompt");
		return [
			{
				id: `prompt:${entry.item.id}`,
				itemId: entry.item.id,
				label: `Jump to prompt ${promptIndex}: ${preview}`,
			},
		];
	});
}

function processPreview(entry: TranscriptProcessEntry) {
	const lastText = entry.items.findLast((item) => item.text.trim())?.text ?? "";
	return getFirstLineTextPreview(lastText.trim() || "No output yet");
}

function messageMeta(
	message: ChatMessage,
	dateTimeFormatMode: DateTimeFormatMode,
) {
	return formatTime(message.time, dateTimeFormatMode);
}

function messageCardTitle(message: ChatMessage) {
	if (message.name === "User" || message.name === "Steer") {
		return "Prompt";
	}
	if (message.name === "Codex") {
		return "Response";
	}
	return message.name;
}

function messageSurfaceClass(message: ChatMessage) {
	const name = messageCardTitle(message);
	if (name === "Prompt") {
		return "bg-transparent";
	}
	if (name === "Response") {
		return "bg-transparent";
	}
	return "bg-transparent";
}

function headerMeta(value: string) {
	return (
		<ScrollableText className="block text-[11px] text-muted">
			{value}
		</ScrollableText>
	);
}

function statusDotClass(status: ThreadDisplayStatus) {
	if (status === "active") {
		return tone.running.dot;
	}
	if (status === "not_loaded" || status === "archived") {
		return tone.stale.dot;
	}
	if (
		status === "system_error" ||
		status === "turn_failed" ||
		status === "turn_interrupted"
	) {
		return tone.error.dot;
	}
	if (status === "turn_completed") {
		return tone.completed.dot;
	}
	return tone.neutral.dot;
}

function HeaderDetailRail({
	tokens,
	status,
	projectName,
}: {
	tokens: number;
	status: ThreadDisplayStatus;
	projectName: string | null;
}) {
	return (
		<div className="scrollable-row flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
			<span className="shrink-0 rounded-full bg-control/70 px-1.5 py-0.5 leading-none">
				{formatTokens(tokens)} tk
			</span>
			<span className="inline-flex shrink-0 items-center gap-1.5 text-muted-strong">
				<span
					className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(status))}
					aria-hidden="true"
				/>
				<span>{statusLabel(status)}</span>
			</span>
			{projectName ? <span className="shrink-0">{projectName}</span> : null}
		</div>
	);
}

const WorkspaceHeader = memo(function WorkspaceHeader({
	mode,
	name,
	tokens,
	status,
	projectName,
	commandVisible,
	navigatorVisible,
	inspectorVisible,
	onToggleNavigator,
	onToggleInspector,
	onOpenCommands,
}: {
	mode: "desktop" | "mobile";
	name: string;
	tokens: number;
	status: ThreadDisplayStatus;
	projectName: string | null;
	commandVisible: boolean;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	onToggleNavigator: () => void;
	onToggleInspector: () => void;
	onOpenCommands?: () => void;
}) {
	const mobile = mode === "mobile";
	return (
		<header
			data-mobile-workspace-header={mobile ? "" : undefined}
			className={cn(
				"relative flex shrink-0 items-center justify-between",
				mobile
					? "min-h-[var(--mobile-header-height)] gap-2 px-3 pt-[var(--workspace-header-top-gap)] md:hidden"
					: "hidden gap-3 md:relative md:flex md:min-h-[calc(var(--workspace-header-content-height)+var(--workspace-header-top-gap))] md:px-5 md:pt-[var(--workspace-header-top-gap)]",
				layer.workspaceChromeZ,
			)}
		>
			<LargeIconButton
				className={mobile ? "h-9 w-9" : undefined}
				title={navigatorVisible ? "Hide threads" : "Open threads"}
				aria-label={navigatorVisible ? "Hide threads" : "Open threads"}
				pressed={navigatorVisible}
				onClick={onToggleNavigator}
			>
				<Menu size={15} />
			</LargeIconButton>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<ScrollableText
					wheelScrollable={!mobile}
					className={cn(
						"font-semibold leading-5 text-fg-strong",
						mobile ? "text-[14px]" : "text-[15px]",
					)}
				>
					{name}
				</ScrollableText>
				<HeaderDetailRail
					tokens={tokens}
					status={status}
					projectName={projectName}
				/>
			</div>
			<div
				className={cn(
					"flex min-w-fit shrink-0 items-center",
					mobile ? "gap-1" : "gap-2",
				)}
			>
				{onOpenCommands ? (
					<LargeIconButton
						className={mobile ? "h-9 w-9" : undefined}
						title="Toggle commands"
						aria-label="Toggle commands"
						pressed={commandVisible}
						onClick={onOpenCommands}
					>
						<Search size={15} />
					</LargeIconButton>
				) : null}
				<LargeIconButton
					className={mobile ? "h-9 w-9" : undefined}
					title={inspectorVisible ? "Hide settings" : "Open settings"}
					aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
					pressed={inspectorVisible}
					onClick={onToggleInspector}
				>
					<Settings size={15} />
				</LargeIconButton>
			</div>
		</header>
	);
});

const CopyTextButton = memo(function CopyTextButton({
	value,
	label = "Copy",
}: {
	value: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const copyValue = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			setCopied(true);
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = setTimeout(() => setCopied(false), 1200);
			void copyToClipboard(value);
		},
		[value],
	);

	return (
		<CopyIconButton label={label} onClick={copyValue}>
			{copied ? <Check size={12} /> : <Copy size={12} />}
		</CopyIconButton>
	);
});

const DismissibleAlert = memo(function DismissibleAlert({
	message,
	onDismiss,
	toneClass,
	buttonClassName,
	dismissLabel,
	role = "status",
}: {
	message: string;
	onDismiss: () => void;
	toneClass: string;
	buttonClassName: string;
	dismissLabel: string;
	role?: "status" | "alert";
}) {
	return (
		<div
			className={cn(ui.alert, toneClass, "flex items-center gap-2 pr-2")}
			role={role}
		>
			<span className="min-w-0 flex-1 break-words leading-5">{message}</span>
			<button
				type="button"
				className={cn(ui.alertDismissButton, buttonClassName)}
				aria-label={dismissLabel}
				title={dismissLabel}
				onClick={onDismiss}
			>
				<X size={13} />
			</button>
		</div>
	);
});

const MessageBlock = memo(function MessageBlock({
	message,
	wrapContent,
	dateTimeFormatMode,
}: {
	message: ChatMessage;
	wrapContent: boolean;
	dateTimeFormatMode: DateTimeFormatMode;
}) {
	const [expanded, setExpanded] = useState(true);
	const preview = getFirstLineTextPreview(message.text || "Pending...");

	return (
		<CollapsibleCard
			title={messageCardTitle(message)}
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
			meta={headerMeta(messageMeta(message, dateTimeFormatMode))}
			actions={<CopyTextButton value={message.copyText} />}
			preview={
				<div className="truncate text-[12px] leading-5 text-muted">
					{preview}
				</div>
			}
			surface="plain"
			className={messageSurfaceClass(message)}
			bodyPaddingClassName={transcriptCardBodyPaddingClass}
			headerButtonPaddingClassName={transcriptCardPaddingClass}
			previewPaddingClassName={transcriptCardPreviewPaddingClass}
		>
			{message.text ? (
				<div
					className={cn(
						"text-[length:var(--transcript-font-size)] leading-[var(--transcript-line-height)] text-fg-strong",
						wrapContent
							? "whitespace-pre-wrap break-words"
							: "overflow-x-auto whitespace-pre",
					)}
				>
					{message.text}
				</div>
			) : null}
		</CollapsibleCard>
	);
});

const TranscriptEntryBlock = memo(function TranscriptEntryBlock({
	entry,
	wrapContent,
	dateTimeFormatMode,
}: {
	entry: TranscriptEntry;
	wrapContent: boolean;
	dateTimeFormatMode: DateTimeFormatMode;
}) {
	return entry.kind === "process" ? (
		<ProcessOutputBlock
			entry={entry}
			wrapContent={wrapContent}
			dateTimeFormatMode={dateTimeFormatMode}
		/>
	) : (
		<MessageBlock
			message={messageFromItem(entry.item)}
			wrapContent={wrapContent}
			dateTimeFormatMode={dateTimeFormatMode}
		/>
	);
});

const ProcessItemBlock = memo(function ProcessItemBlock({
	message,
	wrapContent,
	dateTimeFormatMode,
}: {
	message: ChatMessage;
	wrapContent: boolean;
	dateTimeFormatMode: DateTimeFormatMode;
}) {
	const [expanded, setExpanded] = useState(false);
	const preview = getFirstLineTextPreview(message.text || "Pending...");

	return (
		<CollapsibleCard
			title={message.name}
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
			meta={headerMeta(messageMeta(message, dateTimeFormatMode))}
			actions={<CopyTextButton value={message.copyText} />}
			preview={
				<div className="truncate text-[11px] leading-5 text-muted">
					{preview}
				</div>
			}
			size="compact"
			surface="plain"
			className="bg-transparent"
			bodyPaddingClassName="px-0 pb-3 pt-1"
			headerButtonPaddingClassName={transcriptCardPaddingClass}
			previewPaddingClassName="px-0 pb-2"
		>
			{message.text ? (
				<div
					className={cn(
						"text-[length:var(--process-font-size)] leading-[var(--process-line-height)] text-fg",
						wrapContent
							? "whitespace-pre-wrap break-words"
							: "overflow-x-auto whitespace-pre",
					)}
				>
					{message.text}
				</div>
			) : null}
		</CollapsibleCard>
	);
});

const ProcessOutputBlock = memo(function ProcessOutputBlock({
	entry,
	wrapContent,
	dateTimeFormatMode,
}: {
	entry: TranscriptProcessEntry;
	wrapContent: boolean;
	dateTimeFormatMode: DateTimeFormatMode;
}) {
	const [expanded, setExpanded] = useState(false);
	const messages = useMemo(
		() => (expanded ? entry.items.map(messageFromItem) : []),
		[entry.items, expanded],
	);
	const itemCountLabel = `${entry.items.length} ${entry.items.length === 1 ? "event" : "events"}`;
	const metaLabel = `${itemCountLabel} / ${formatTime(
		entry.createdAt,
		dateTimeFormatMode,
	)}`;
	const preview = useMemo(() => processPreview(entry), [entry]);
	const copyText = useMemo(
		() =>
			expanded
				? entry.items
						.map((item) => item.text)
						.filter(Boolean)
						.join("\n\n")
				: preview,
		[entry.items, expanded, preview],
	);

	return (
		<CollapsibleCard
			title="Thoughts"
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
			meta={headerMeta(metaLabel)}
			actions={<CopyTextButton value={copyText || preview} />}
			size="prominent"
			preview={
				<div className="truncate text-[12px] leading-5 text-muted">
					{preview}
				</div>
			}
			bodyPaddingClassName={transcriptProcessBodyPaddingClass}
			headerButtonPaddingClassName={transcriptCardPaddingClass}
			previewPaddingClassName={transcriptCardPreviewPaddingClass}
			surface="plain"
			className="bg-transparent"
		>
			{messages.map((message) => (
				<ProcessItemBlock
					key={message.id}
					message={message}
					wrapContent={wrapContent}
					dateTimeFormatMode={dateTimeFormatMode}
				/>
			))}
		</CollapsibleCard>
	);
});

const EmptyTranscript = memo(function EmptyTranscript({
	hasThread,
	projectPath,
}: {
	hasThread: boolean;
	projectPath: string;
}) {
	return (
		<div className="px-5 py-8 text-center">
			<div
				className={cn("mx-auto mb-4 h-10 w-10 text-muted-strong", ui.iconBox)}
			>
				<Bot size={22} />
			</div>
			<h2 className="text-[15px] font-semibold text-fg-strong">
				{hasThread
					? "Waiting for Codex transcript"
					: "No Codex thread selected"}
			</h2>
			<p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-muted">
				{hasThread
					? "This app-server thread has no persisted transcript items yet. Send a prompt or resume the thread to continue."
					: `Create a Codex app-server thread for ${projectPath} or select an existing thread from the navigator.`}
			</p>
		</div>
	);
});

const ComposerMenuItem = memo(function ComposerMenuItem({
	action,
	onSelect,
}: {
	action: ComposerMenuAction;
	onSelect: (action: ComposerMenuAction) => void;
}) {
	const disabled = Boolean(action.disabledReason);
	return (
		<MenuItemButton
			className="h-8 w-full items-center px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
			role="menuitem"
			disabled={disabled}
			title={action.disabledReason ?? action.label}
			aria-label={
				action.disabledReason
					? `${action.label}: ${action.disabledReason}`
					: action.label
			}
			onClick={() => onSelect(action)}
		>
			<span className="truncate leading-5 text-current">{action.label}</span>
		</MenuItemButton>
	);
});

type ComposerProps = Pick<
	WorkspaceProps,
	| "workdir"
	| "busy"
	| "busyAction"
	| "notice"
	| "onDismissNotice"
	| "error"
	| "onDismissError"
	| "prompt"
	| "promptTarget"
	| "goalMode"
	| "canUseGoalMode"
	| "canSubmitPrompt"
	| "selectedThread"
	| "selectedThreadId"
	| "onPromptChange"
	| "onPromptKeyDown"
	| "onPromptSubmit"
	| "onModeChange"
	| "onWorkdirChange"
	| "onGoalModeChange"
	| "onInterrupt"
	| "onResume"
	| "onFork"
	| "onCompact"
	| "onArchive"
	| "onListBackgroundTerminals"
	| "onCleanBackgroundTerminals"
> & {
	onPromptFocusIntent?: () => void;
	onPromptViewportChange?: () => void;
};

const Composer = memo(
	forwardRef<ComposerHandle, ComposerProps>(function Composer(
		{
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
			selectedThreadId,
			canUseGoalMode,
			canSubmitPrompt,
			selectedThread,
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
			onPromptFocusIntent,
			onPromptViewportChange,
		},
		ref,
	) {
		const textareaRef = useRef<HTMLTextAreaElement | null>(null);
		const selectedThreadArchived = Boolean(selectedThread?.archivedAt);
		const selectedThreadPendingSubmission =
			isOptimisticThreadId(selectedThreadId) ||
			isOptimisticTurnId(selectedThread?.activeTurnId);
		const [moreActionsOpen, setMoreActionsOpen] = useState(false);
		const submitTitle = goalMode
			? codexThreadCommandLabels.goal
			: promptTarget === "thread"
				? "Send prompt"
				: "Create thread";
		const placeholder = goalMode
			? "/goal"
			: promptTarget === "thread"
				? "/prompt"
				: "/new";
		const threadActionDisabledReason = () => {
			if (!selectedThreadId) {
				return "Select a thread first";
			}
			if (selectedThreadArchived) {
				return "Archived threads are view-only";
			}
			if (selectedThreadPendingSubmission) {
				return "Wait for the submission to finish";
			}
			if (busy) {
				return "Another action is running";
			}
			return null;
		};
		const idleThreadActionDisabledReason = () => {
			const baseReason = threadActionDisabledReason();
			if (baseReason) {
				return baseReason;
			}
			if (selectedThread?.status === "active") {
				return "Wait for the active turn to finish";
			}
			return null;
		};
		const interruptDisabledReason = () => {
			if (!selectedThreadId) {
				return "Select a running thread first";
			}
			if (selectedThreadArchived) {
				return "Archived threads are view-only";
			}
			if (busy) {
				return "Another action is running";
			}
			if (selectedThread?.status !== "active") {
				return "No active turn is running";
			}
			return null;
		};
		const resumeDisabledReason = () => {
			const baseReason = threadActionDisabledReason();
			if (baseReason) {
				return baseReason;
			}
			if (selectedThread?.status === "active") {
				return "Thread is already running";
			}
			return null;
		};
		const composerMenuActions: ComposerMenuAction[] = [
			{
				id: "archive",
				label: codexThreadCommandLabels.archive,
				detail: "Move this thread out of the active list",
				disabledReason: idleThreadActionDisabledReason(),
				run: onArchive,
			},
			{
				id: "compact",
				label: codexThreadCommandLabels.compact,
				detail: "Summarize the transcript for more context",
				disabledReason: idleThreadActionDisabledReason(),
				run: onCompact,
			},
			{
				id: "interrupt",
				label: codexThreadCommandLabels.interrupt,
				detail: "Stop the currently running turn",
				disabledReason: interruptDisabledReason(),
				run: onInterrupt,
			},
			{
				id: "fork",
				label: codexThreadCommandLabels.fork,
				detail: "Continue from this thread in a new branch",
				disabledReason: threadActionDisabledReason(),
				run: onFork,
			},
			{
				id: "ps",
				label: codexThreadCommandLabels.ps,
				detail: "List app-server background terminals",
				disabledReason: threadActionDisabledReason(),
				run: onListBackgroundTerminals,
			},
			{
				id: "stop",
				label: codexThreadCommandLabels.stop,
				detail: "Stop app-server background terminals",
				disabledReason: threadActionDisabledReason(),
				run: onCleanBackgroundTerminals,
			},
			{
				id: "resume",
				label: codexThreadCommandLabels.resume,
				detail: "Resume this saved thread",
				disabledReason: resumeDisabledReason(),
				run: onResume,
			},
		];
		const selectComposerMenuAction = (action: ComposerMenuAction) => {
			action.run();
			setMoreActionsOpen(false);
		};

		useImperativeHandle(
			ref,
			() => ({
				focusPrompt: () => {
					const textarea = textareaRef.current;
					if (!textarea || textarea.disabled) {
						return false;
					}
					textarea.focus({ preventScroll: true });
					const caret = textarea.value.length;
					textarea.setSelectionRange(caret, caret);
					return true;
				},
			}),
			[],
		);

		useAutosizeLayoutEffect(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}
			const lineHeight = Number.parseFloat(
				window.getComputedStyle(textarea).lineHeight,
			);
			const minHeight = Number.isFinite(lineHeight) ? lineHeight : 26;
			textarea.style.height = "auto";
			const maxHeight =
				typeof window.matchMedia === "function" &&
				window.matchMedia("(max-width: 767px)").matches
					? 112
					: 160;
			textarea.style.height = `${Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight))}px`;
		});

		const focusPromptOnNextFrame = useCallback(() => {
			window.requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea || textarea.disabled) {
					return;
				}
				textarea.focus({ preventScroll: true });
				const caret = textarea.value.length;
				textarea.setSelectionRange(caret, caret);
			});
		}, []);

		return (
			<div>
				<AnimatePresence initial={false}>
					{busyAction || notice || error ? (
						<motion.div
							key="composer-alerts"
							className="mb-3 grid gap-2 overflow-hidden text-[12px]"
							initial={revealMotion.initial}
							animate={revealMotion.animate}
							exit={revealMotion.exit}
							transition={motionPresets.item}
						>
							{busyAction ? (
								<div className={cn(ui.alert, tone.neutral.alert)}>
									{busyAction}...
								</div>
							) : null}
							{notice ? (
								<DismissibleAlert
									message={notice}
									onDismiss={onDismissNotice}
									toneClass={tone.running.alert}
									buttonClassName=""
									dismissLabel="Dismiss notice"
								/>
							) : null}
							{error ? (
								<DismissibleAlert
									message={error}
									onDismiss={onDismissError}
									toneClass={tone.error.alert}
									buttonClassName=""
									dismissLabel="Dismiss error"
									role="alert"
								/>
							) : null}
						</motion.div>
					) : null}
				</AnimatePresence>

				<AnimatePresence initial={false}>
					{promptTarget === "new" ? (
						<motion.div
							key="composer-workdir"
							className="mb-1 overflow-hidden"
							initial={revealMotion.initial}
							animate={revealMotion.animate}
							exit={revealMotion.exit}
							transition={motionPresets.item}
						>
							<FieldShell className="h-8 px-2.5">
								<div className="workdir-input-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
									<input
										className={cn(
											ui.input,
											"block h-[1lh] min-w-full flex-none whitespace-nowrap font-mono text-[12px] leading-4 text-fg",
										)}
										style={{
											width: `${Math.max(workdir.length + 4, 48)}ch`,
										}}
										value={workdir}
										onChange={(event) => onWorkdirChange(event.target.value)}
										placeholder="/path/to/repo"
										disabled={busy}
										aria-label="Working directory"
										autoCapitalize="off"
										autoCorrect="off"
										spellCheck={false}
										inputMode="url"
									/>
								</div>
							</FieldShell>
						</motion.div>
					) : null}
				</AnimatePresence>

				<form onSubmit={onPromptSubmit} autoComplete="off">
					<div className={ui.composerShell}>
						<textarea
							ref={textareaRef}
							rows={1}
							className={cn(
								ui.textarea,
								"max-h-[112px] min-h-[var(--composer-line-height)] px-0 text-[length:var(--composer-font-size)] leading-[var(--composer-line-height)] md:max-h-[160px]",
							)}
							value={prompt}
							onChange={(event) => onPromptChange(event.target.value)}
							onKeyDown={onPromptKeyDown}
							onPointerDown={onPromptFocusIntent}
							onTouchStart={onPromptFocusIntent}
							onFocus={onPromptViewportChange}
							onBlur={onPromptViewportChange}
							placeholder={placeholder}
							disabled={busy}
							autoComplete="off"
							autoCapitalize="sentences"
							autoCorrect="on"
							spellCheck={true}
						/>
						<div className="flex min-h-8 items-center justify-between gap-3">
							<div className="flex min-w-0 items-center gap-1.5">
								<ComposerIconButton
									title={codexThreadCommandLabels.new}
									aria-label={codexThreadCommandLabels.new}
									pressed={promptTarget === "new"}
									disabled={busy}
									onClick={() => {
										onModeChange(
											promptTarget === "new" && selectedThreadId
												? "thread"
												: "new",
										);
										focusPromptOnNextFrame();
									}}
								>
									<Plus size={14} />
								</ComposerIconButton>
								<ComposerIconButton
									title={codexThreadCommandLabels.goal}
									aria-label={codexThreadCommandLabels.goal}
									pressed={goalMode}
									disabled={!canUseGoalMode || busy}
									onClick={() => onGoalModeChange(!goalMode)}
								>
									<Goal size={14} />
								</ComposerIconButton>
								<div className={cn("relative", layer.localBackdropZ)}>
									<ComposerIconButton
										className={
											moreActionsOpen
												? cn("relative", layer.localMenuZ)
												: undefined
										}
										title="More actions"
										aria-label="More actions"
										pressed={moreActionsOpen}
										aria-haspopup="menu"
										aria-expanded={moreActionsOpen}
										onClick={() => setMoreActionsOpen((v) => !v)}
									>
										<Ellipsis size={14} />
									</ComposerIconButton>
									<AnimatePresence>
										{moreActionsOpen ? (
											<>
												<motion.div
													className={cn("fixed inset-0", layer.localBackdropZ)}
													initial={overlayMotion.initial}
													animate={overlayMotion.animate}
													exit={overlayMotion.exit}
													transition={motionPresets.fade}
													onClick={() => setMoreActionsOpen(false)}
												/>
												<motion.div
													className={cn(
														"absolute bottom-full left-0 mb-2 w-36 max-w-[calc(100vw-2rem)] p-1",
														layer.localMenuZ,
														ui.popover,
													)}
													role="menu"
													initial={localMenuMotion.initial}
													animate={localMenuMotion.animate}
													exit={localMenuMotion.exit}
													transition={motionPresets.quick}
												>
													{composerMenuActions.map((action) => (
														<ComposerMenuItem
															key={action.id}
															action={action}
															onSelect={selectComposerMenuAction}
														/>
													))}
												</motion.div>
											</>
										) : null}
									</AnimatePresence>
								</div>
							</div>
							<button
								type="submit"
								className={ui.submitButton}
								disabled={!canSubmitPrompt}
								suppressHydrationWarning
								title={submitTitle}
								aria-label={submitTitle}
							>
								{goalMode ? <Goal size={14} /> : <Send size={14} />}
							</button>
						</div>
					</div>
				</form>
			</div>
		);
	}),
);

export const Workspace = memo(
	forwardRef<WorkspaceHandle, WorkspaceProps>(function Workspace(
		{
			presentationMode = "desktop",
			project,
			threadSummary,
			detail,
			selectedThread,
			selectedThreadId,
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
			wrapThreadContent,
			displayScale,
			commandVisible,
			navigatorVisible,
			inspectorVisible,
			submittedPromptFocusTarget,
			canUseGoalMode,
			canSubmitPrompt,
			loadingEarlierTranscript,
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
			onLoadEarlierTranscript,
			onToggleNavigator,
			onToggleInspector,
			onOpenCommands,
			dateTimeFormatMode = "utc",
		},
		ref,
	) {
		const composerRef = useRef<ComposerHandle | null>(null);
		const composerShellRef = useRef<HTMLDivElement | null>(null);
		const rootRef = useRef<HTMLElement | null>(null);
		const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
		const mobileTranscriptDetailIdRef = useRef<string | null>(null);
		const preservedTranscriptScrollTopRef = useRef<number | null>(null);
		const handledSubmittedPromptFocusRef = useRef<number | null>(null);
		const transcriptScrollId = useId();
		const [mobileVisibleEntryCount, setMobileVisibleEntryCount] = useState(
			mobileTranscriptInitialWindow,
		);
		const entries = useMemo(
			() => transcriptEntriesFromDetail(detail),
			[detail],
		);
		const isMobilePresentation = presentationMode === "mobile";
		const visibleEntries = useMemo(() => {
			if (!isMobilePresentation) {
				return entries;
			}
			return entries.slice(-mobileVisibleEntryCount);
		}, [entries, isMobilePresentation, mobileVisibleEntryCount]);
		const hiddenEntries = isMobilePresentation
			? entries.slice(0, Math.max(0, entries.length - visibleEntries.length))
			: [];
		const hiddenItemCount = useMemo(
			() => transcriptHiddenItemCount(hiddenEntries),
			[hiddenEntries],
		);
		const canLoadEarlierEntries = hiddenEntries.length > 0;
		const canLoadEarlierTranscriptItems = Boolean(
			detail?.itemPageDirection === "before" &&
				detail.itemHasMore &&
				detail.itemNextCursor,
		);
		const canShowEarlierTranscriptControl =
			canLoadEarlierEntries || canLoadEarlierTranscriptItems;
		const earlierTranscriptLabel = canLoadEarlierEntries
			? `Show ${hiddenItemCount} earlier transcript ${
					hiddenItemCount === 1 ? "item" : "items"
				}`
			: loadingEarlierTranscript
				? "Loading earlier transcript..."
				: "Load earlier transcript";
		const promptAnchors = useMemo(
			() => transcriptPromptAnchors(visibleEntries),
			[visibleEntries],
		);
		const name =
			selectedThread?.name ?? threadSummary?.name ?? "New Codex thread";
		const tokens = detail?.tokensUsed ?? threadSummary?.tokensUsed ?? 0;
		const status = selectedThread
			? threadDisplayStatus(selectedThread)
			: (threadSummary?.status ?? "idle");
		const projectName = project?.name ?? null;
		const contentScaleStyle = useMemo(
			() =>
				({
					"--transcript-font-size": `${14 * displayScale}px`,
					"--transcript-line-height": `${24 * displayScale}px`,
					"--process-font-size": `${13 * displayScale}px`,
					"--process-line-height": `${22 * displayScale}px`,
					"--composer-font-size": `${16 * displayScale}px`,
					"--composer-line-height": `${26 * displayScale}px`,
					"--transcript-gap": `${Math.max(9, 12 * displayScale)}px`,
				}) as CSSProperties,
			[displayScale],
		);

		useImperativeHandle(
			ref,
			() => ({
				focusPrompt: () => composerRef.current?.focusPrompt() ?? false,
			}),
			[],
		);

		useEffect(() => {
			const detailId = detail?.id ?? null;
			if (mobileTranscriptDetailIdRef.current === detailId) {
				return;
			}
			mobileTranscriptDetailIdRef.current = detailId;
			setMobileVisibleEntryCount(mobileTranscriptInitialWindow);
		});

		useEffect(() => {
			const root = rootRef.current;
			const composerShell = composerShellRef.current;
			const transcriptScroll = transcriptScrollRef.current;
			if (!root || !composerShell) {
				return;
			}

			let frame: number | null = null;
			const updateComposerMetrics = () => {
				frame = null;
				root.style.setProperty(
					"--composer-height",
					`${Math.ceil(composerShell.getBoundingClientRect().height)}px`,
				);
				const scrollbarWidth = transcriptScroll
					? Math.max(
							0,
							transcriptScroll.offsetWidth - transcriptScroll.clientWidth,
						)
					: 0;
				root.style.setProperty(
					"--transcript-scrollbar-width",
					`${Math.ceil(scrollbarWidth)}px`,
				);
			};
			const scheduleUpdate = () => {
				if (frame !== null) {
					return;
				}
				frame = window.requestAnimationFrame(updateComposerMetrics);
			};

			const observer = new ResizeObserver(scheduleUpdate);
			observer.observe(composerShell);
			if (transcriptScroll) {
				observer.observe(transcriptScroll);
			}
			scheduleUpdate();

			return () => {
				if (frame !== null) {
					window.cancelAnimationFrame(frame);
				}
				observer.disconnect();
				root.style.removeProperty("--composer-height");
				root.style.removeProperty("--transcript-scrollbar-width");
			};
		}, []);

		const captureMobileTranscriptPosition = useCallback(() => {
			if (
				typeof window.matchMedia !== "function" ||
				!window.matchMedia("(max-width: 767px)").matches
			) {
				return;
			}
			const scrollElement = transcriptScrollRef.current;
			if (!scrollElement) {
				return;
			}
			preservedTranscriptScrollTopRef.current = scrollElement.scrollTop;
		}, []);

		const restoreMobileTranscriptPosition = useCallback(() => {
			if (
				typeof window.matchMedia !== "function" ||
				!window.matchMedia("(max-width: 767px)").matches
			) {
				return;
			}
			const scrollElement = transcriptScrollRef.current;
			if (!scrollElement) {
				return;
			}
			if (preservedTranscriptScrollTopRef.current === null) {
				preservedTranscriptScrollTopRef.current = scrollElement.scrollTop;
			}

			const restorePosition = () => {
				const scrollTop = preservedTranscriptScrollTopRef.current;
				if (scrollTop === null) {
					return;
				}
				scrollElement.scrollTop = scrollTop;
			};

			window.requestAnimationFrame(restorePosition);
			window.setTimeout(restorePosition, 120);
			window.setTimeout(restorePosition, 300);
		}, []);

		const loadEarlierTranscript = useCallback(() => {
			if (canLoadEarlierEntries) {
				setMobileVisibleEntryCount((current) =>
					Math.min(entries.length, current + mobileTranscriptWindowStep),
				);
				return;
			}
			if (!canLoadEarlierTranscriptItems || loadingEarlierTranscript) {
				return;
			}
			const scrollElement = transcriptScrollRef.current;
			const previousScrollHeight = scrollElement?.scrollHeight ?? null;
			const previousScrollTop = scrollElement?.scrollTop ?? null;
			void onLoadEarlierTranscript().finally(() => {
				if (
					!scrollElement ||
					previousScrollHeight === null ||
					previousScrollTop === null
				) {
					return;
				}
				const restorePosition = () => {
					scrollElement.scrollTop =
						scrollElement.scrollHeight -
						previousScrollHeight +
						previousScrollTop;
				};
				window.requestAnimationFrame(restorePosition);
				window.setTimeout(restorePosition, 80);
				window.setTimeout(restorePosition, 220);
			});
		}, [
			canLoadEarlierEntries,
			canLoadEarlierTranscriptItems,
			entries.length,
			loadingEarlierTranscript,
			onLoadEarlierTranscript,
		]);

		useEffect(() => {
			const target = submittedPromptFocusTarget;
			if (
				!target ||
				handledSubmittedPromptFocusRef.current === target.sequence
			) {
				return;
			}
			const scrollElement = transcriptScrollRef.current;
			if (!scrollElement) {
				return;
			}
			const selector = `[data-transcript-item-id="${CSS.escape(target.itemId)}"]`;
			let attempts = 0;
			let timer: number | null = null;
			let frame: number | null = null;

			const focusSubmittedPrompt = () => {
				attempts += 1;
				const targetElement =
					scrollElement.querySelector<HTMLElement>(selector);
				if (targetElement) {
					handledSubmittedPromptFocusRef.current = target.sequence;
					targetElement.scrollIntoView({
						block: "nearest",
						inline: "nearest",
						behavior: "smooth",
					});
					targetElement.focus({ preventScroll: true });
					return;
				}
				if (attempts >= 8) {
					handledSubmittedPromptFocusRef.current = target.sequence;
					return;
				}
				timer = window.setTimeout(scheduleFocus, attempts < 3 ? 40 : 120);
			};

			const scheduleFocus = () => {
				frame = window.requestAnimationFrame(focusSubmittedPrompt);
			};

			scheduleFocus();
			return () => {
				if (frame !== null) {
					window.cancelAnimationFrame(frame);
				}
				if (timer !== null) {
					window.clearTimeout(timer);
				}
			};
		}, [submittedPromptFocusTarget]);

		return (
			<section
				ref={rootRef}
				className={cn("flex h-full min-h-0 min-w-0 flex-col bg-app-bg text-fg")}
				style={contentScaleStyle}
			>
				{isMobilePresentation ? (
					<WorkspaceHeader
						mode="mobile"
						name={name}
						tokens={tokens}
						status={status}
						projectName={projectName}
						commandVisible={commandVisible}
						navigatorVisible={navigatorVisible}
						inspectorVisible={inspectorVisible}
						onToggleNavigator={onToggleNavigator}
						onToggleInspector={onToggleInspector}
						onOpenCommands={onOpenCommands}
					/>
				) : null}
				{!isMobilePresentation ? (
					<WorkspaceHeader
						mode="desktop"
						name={name}
						tokens={tokens}
						status={status}
						projectName={projectName}
						commandVisible={commandVisible}
						navigatorVisible={navigatorVisible}
						inspectorVisible={inspectorVisible}
						onToggleNavigator={onToggleNavigator}
						onToggleInspector={onToggleInspector}
						onOpenCommands={onOpenCommands}
					/>
				) : null}

				<div className="flex min-h-0 flex-1">
					<motion.div
						className="flex min-h-0 min-w-0 flex-1 flex-col"
						animate={{ width: "100%" }}
						transition={motionPresets.panel}
					>
						<ScrollArea
							id={transcriptScrollId}
							scrollRef={transcriptScrollRef}
							outerClassName="flex-1 [--transcript-navigator-right-inset:0.75rem] md:[--transcript-navigator-right-inset:1.25rem]"
							className="transcript-custom-scroll mobile-transcript-scroll px-3 py-0 md:px-5"
							edgeFades={{ tone: "app", top: true, bottom: "tall" }}
							floatingScroller={{
								anchors: promptAnchors,
								contentRightInset: "var(--transcript-navigator-right-inset)",
								visibility: "always",
							}}
						>
							<ThreadContentFrame className="grid gap-[var(--transcript-gap)]">
								{entries.length === 0 ? (
									<div className="min-w-0">
										<EmptyTranscript
											hasThread={Boolean(selectedThreadId)}
											projectPath={project?.path ?? workdir}
										/>
									</div>
								) : null}
								{canShowEarlierTranscriptControl ? (
									<div className="flex justify-center">
										<button
											type="button"
											disabled={loadingEarlierTranscript}
											className={cn(
												"min-h-10 gap-2 rounded-[8px] bg-control px-3.5 text-[12px] font-medium text-muted-strong active:bg-control-hover disabled:cursor-wait disabled:opacity-60",
												ui.row,
											)}
											onClick={loadEarlierTranscript}
										>
											<Plus size={14} aria-hidden="true" />
											<span>{earlierTranscriptLabel}</span>
										</button>
									</div>
								) : null}
								<AnimatePresence initial={false}>
									{visibleEntries.map((entry) => (
										<motion.div
											key={entry.id}
											className="min-w-0 scroll-mt-3 focus:outline-none"
											{...transcriptItemDataAttributes(entry)}
											initial={transcriptItemMotion.initial}
											animate={transcriptItemMotion.animate}
											exit={transcriptItemMotion.exit}
											transition={motionPresets.fade}
										>
											<TranscriptEntryBlock
												entry={entry}
												wrapContent={wrapThreadContent}
												dateTimeFormatMode={dateTimeFormatMode}
											/>
										</motion.div>
									))}
								</AnimatePresence>
							</ThreadContentFrame>
						</ScrollArea>

						<div
							ref={composerShellRef}
							className={cn(
								"mobile-composer-bar relative shrink-0 overflow-visible pb-[var(--workspace-composer-bottom-gap)] pl-3 pr-[calc(0.75rem+var(--transcript-scrollbar-width,0px))] md:pl-5 md:pr-[calc(1.25rem+var(--transcript-scrollbar-width,0px))]",
								layer.composerZ,
							)}
						>
							<ThreadContentFrame>
								<Composer
									ref={composerRef}
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
									selectedThreadId={selectedThreadId}
									selectedThread={selectedThread}
									canUseGoalMode={canUseGoalMode}
									canSubmitPrompt={canSubmitPrompt}
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
									onPromptFocusIntent={captureMobileTranscriptPosition}
									onPromptViewportChange={restoreMobileTranscriptPosition}
								/>
							</ThreadContentFrame>
						</div>
					</motion.div>
				</div>
			</section>
		);
	}),
);
