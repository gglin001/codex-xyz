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
	Terminal,
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
import { cn, layer, motionPresets, tone, ui } from "../designSystem.js";
import { getFirstLineTextPreview } from "../textPreview.js";
import {
	getTranscriptEntries,
	type TranscriptEntry,
	type TranscriptProcessEntry,
} from "../transcriptEntries.js";
import {
	formatTime,
	formatTokens,
	itemTitle,
	statusLabel,
} from "../uiFormat.js";
import { MobileFloatingScroller } from "./MobileFloatingScroller.js";
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
	displayScale: number;
	commandVisible: boolean;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	terminalVisible: boolean;
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
	onToggleNavigator: () => void;
	onToggleInspector: () => void;
	onToggleTerminal?: () => void;
	onOpenCommands?: () => void;
};

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

const spring = motionPresets.item;
const threadContentWidthClass = "[--thread-content-width:900px]";
const threadContentFrameClass =
	"mx-auto w-full min-w-0 max-w-[var(--thread-content-width)]";
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
		name: itemTitle(item),
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

function processPreview(entry: TranscriptProcessEntry) {
	const lastText = entry.items.findLast((item) => item.text.trim())?.text ?? "";
	return getFirstLineTextPreview(lastText.trim() || "No output yet");
}

function messageMeta(message: ChatMessage) {
	return formatTime(message.time);
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
	model,
	projectName,
}: {
	tokens: number;
	status: ThreadDisplayStatus;
	model: string | null;
	projectName: string | null;
}) {
	return (
		<div className="scrollable-row flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
			<span className="shrink-0 rounded-full bg-control/70 px-1.5 py-0.5 leading-none">
				{formatTokens(tokens)} tokens
			</span>
			<span className="inline-flex shrink-0 items-center gap-1.5 text-muted-strong">
				<span
					className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(status))}
					aria-hidden="true"
				/>
				<span>{statusLabel(status)}</span>
			</span>
			{model ? <span className="shrink-0">{model}</span> : null}
			{projectName ? <span className="shrink-0">{projectName}</span> : null}
		</div>
	);
}

const WorkspaceHeader = memo(function WorkspaceHeader({
	mode,
	name,
	tokens,
	status,
	model,
	projectName,
	commandVisible,
	navigatorVisible,
	inspectorVisible,
	terminalVisible,
	onToggleNavigator,
	onToggleInspector,
	onToggleTerminal,
	onOpenCommands,
}: {
	mode: "desktop" | "mobile";
	name: string;
	tokens: number;
	status: ThreadDisplayStatus;
	model: string | null;
	projectName: string | null;
	commandVisible: boolean;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	terminalVisible: boolean;
	onToggleNavigator: () => void;
	onToggleInspector: () => void;
	onToggleTerminal?: () => void;
	onOpenCommands?: () => void;
}) {
	const mobile = mode === "mobile";
	return (
		<header
			className={cn(
				"relative flex shrink-0 items-center justify-between",
				mobile
					? "gap-2 px-3 pt-[calc(var(--safe-inset-top)+0.125rem)] md:hidden"
					: "hidden gap-3 md:relative md:flex md:h-9 md:px-5",
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
					model={model}
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
				{mobile && onToggleTerminal ? (
					<LargeIconButton
						className="h-9 w-9"
						title={terminalVisible ? "Hide terminal" : "Open terminal"}
						aria-label={terminalVisible ? "Hide terminal" : "Open terminal"}
						pressed={terminalVisible}
						onClick={onToggleTerminal}
					>
						<Terminal size={15} />
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
}: {
	message: ChatMessage;
	wrapContent: boolean;
}) {
	const [expanded, setExpanded] = useState(true);
	const preview = getFirstLineTextPreview(message.text || "Pending...");

	return (
		<CollapsibleCard
			title={messageCardTitle(message)}
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
			meta={headerMeta(messageMeta(message))}
			actions={<CopyTextButton value={message.copyText} />}
			preview={
				<div className="truncate text-[12px] leading-5 text-muted">
					{preview}
				</div>
			}
			surface="plain"
			className={messageSurfaceClass(message)}
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

const ProcessItemBlock = memo(function ProcessItemBlock({
	message,
	wrapContent,
}: {
	message: ChatMessage;
	wrapContent: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const preview = getFirstLineTextPreview(message.text || "Pending...");

	return (
		<CollapsibleCard
			title={message.name}
			expanded={expanded}
			onToggle={() => setExpanded((current) => !current)}
			meta={headerMeta(messageMeta(message))}
			actions={<CopyTextButton value={message.copyText} />}
			preview={
				<div className="truncate text-[11px] leading-5 text-muted">
					{preview}
				</div>
			}
			size="compact"
			surface="plain"
			className="bg-transparent"
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
}: {
	entry: TranscriptProcessEntry;
	wrapContent: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const messages = useMemo(
		() => (expanded ? entry.items.map(messageFromItem) : []),
		[entry.items, expanded],
	);
	const itemCountLabel = `${entry.items.length} ${entry.items.length === 1 ? "event" : "events"}`;
	const metaLabel = `${itemCountLabel} / ${formatTime(entry.createdAt)}`;
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
			bodyClassName="grid gap-1.5 px-3 pb-3 pt-0"
			surface="plain"
			className="bg-transparent"
		>
			{messages.map((message) => (
				<ProcessItemBlock
					key={message.id}
					message={message}
					wrapContent={wrapContent}
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
			<span className="truncate leading-5 text-fg">{action.label}</span>
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
	onPromptFocus?: () => void;
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
			onPromptFocus,
		},
		ref,
	) {
		const textareaRef = useRef<HTMLTextAreaElement | null>(null);
		const selectedThreadArchived = Boolean(selectedThread?.archivedAt);
		const [moreActionsOpen, setMoreActionsOpen] = useState(false);
		const submitTitle = goalMode
			? codexThreadCommandLabels.goal
			: promptTarget === "thread"
				? "Send prompt"
				: "Create thread";
		const placeholder = goalMode
			? "Describe the goal objective"
			: promptTarget === "thread"
				? "Start typing a prompt"
				: "Start a new Codex thread";
		const threadActionDisabledReason = () => {
			if (!selectedThreadId) {
				return "Select a thread first";
			}
			if (selectedThreadArchived) {
				return "Archived threads are view-only";
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

		useEffect(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}
			const lineHeight = Number.parseFloat(
				window.getComputedStyle(textarea).lineHeight,
			);
			const minHeight = Number.isFinite(lineHeight) ? lineHeight : 26;
			textarea.style.height = "0px";
			textarea.style.height = `${Math.min(160, Math.max(minHeight, textarea.scrollHeight))}px`;
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
				{busyAction || notice || error ? (
					<div className="mb-3 grid gap-2 text-[12px]">
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
					</div>
				) : null}

				{promptTarget === "new" ? (
					<FieldShell className="h-8 px-2.5">
						<div className="workdir-input-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
							<input
								className={cn(
									ui.input,
									"block h-[1lh] min-w-full flex-none whitespace-nowrap font-mono text-[12px] leading-4 text-fg",
								)}
								style={{ width: `${Math.max(workdir.length + 4, 48)}ch` }}
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
				) : null}

				<form onSubmit={onPromptSubmit}>
					<div className={ui.composerShell}>
						<textarea
							ref={textareaRef}
							className={cn(
								ui.textarea,
								"max-h-[160px] min-h-[var(--composer-line-height)] px-0 text-[length:var(--composer-font-size)] leading-[var(--composer-line-height)]",
							)}
							value={prompt}
							onChange={(event) => onPromptChange(event.target.value)}
							onKeyDown={onPromptKeyDown}
							onFocus={onPromptFocus}
							placeholder={placeholder}
							disabled={busy}
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
													initial={{ opacity: 0 }}
													animate={{ opacity: 1 }}
													exit={{ opacity: 0 }}
													onClick={() => setMoreActionsOpen(false)}
												/>
												<motion.div
													className={cn(
														"absolute bottom-full left-0 mb-2 w-36 max-w-[calc(100vw-2rem)] p-1",
														layer.localFloatingZ,
														ui.popover,
													)}
													role="menu"
													initial={{ opacity: 0, y: 6 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: 6 }}
													transition={spring}
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
								className={cn(ui.submitButton, "h-8 min-w-8 px-0")}
								disabled={!canSubmitPrompt}
								title={submitTitle}
								aria-label={submitTitle}
							>
								<Send size={14} />
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
			terminalVisible,
			canUseGoalMode,
			canSubmitPrompt,
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
			onToggleNavigator,
			onToggleInspector,
			onToggleTerminal,
			onOpenCommands,
		},
		ref,
	) {
		const composerRef = useRef<ComposerHandle | null>(null);
		const composerShellRef = useRef<HTMLDivElement | null>(null);
		const rootRef = useRef<HTMLElement | null>(null);
		const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
		const mobileTranscriptDetailIdRef = useRef<string | null>(null);
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
		const name =
			selectedThread?.name ?? threadSummary?.name ?? "New Codex thread";
		const tokens = detail?.tokensUsed ?? threadSummary?.tokensUsed ?? 0;
		const status = selectedThread
			? threadDisplayStatus(selectedThread)
			: (threadSummary?.status ?? "idle");
		const model = selectedThread?.model ?? threadSummary?.model ?? null;
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

		const settleMobilePromptFocus = useCallback(() => {
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

			const scrollToEnd = () => {
				scrollElement.scrollTo({
					top: scrollElement.scrollHeight,
					behavior: "auto",
				});
			};

			window.requestAnimationFrame(scrollToEnd);
			window.setTimeout(scrollToEnd, 180);
			window.setTimeout(scrollToEnd, 360);
		}, []);

		return (
			<section
				ref={rootRef}
				className={cn(
					"flex h-full min-h-0 min-w-0 flex-col bg-app-bg text-fg",
					threadContentWidthClass,
				)}
				style={contentScaleStyle}
			>
				{isMobilePresentation ? (
					<WorkspaceHeader
						mode="mobile"
						name={name}
						tokens={tokens}
						status={status}
						model={model}
						projectName={projectName}
						commandVisible={commandVisible}
						navigatorVisible={navigatorVisible}
						inspectorVisible={inspectorVisible}
						terminalVisible={terminalVisible}
						onToggleNavigator={onToggleNavigator}
						onToggleInspector={onToggleInspector}
						onToggleTerminal={onToggleTerminal}
						onOpenCommands={onOpenCommands}
					/>
				) : null}
				{!isMobilePresentation ? (
					<WorkspaceHeader
						mode="desktop"
						name={name}
						tokens={tokens}
						status={status}
						model={model}
						projectName={projectName}
						commandVisible={commandVisible}
						navigatorVisible={navigatorVisible}
						inspectorVisible={inspectorVisible}
						terminalVisible={terminalVisible}
						onToggleNavigator={onToggleNavigator}
						onToggleInspector={onToggleInspector}
						onToggleTerminal={onToggleTerminal}
						onOpenCommands={onOpenCommands}
					/>
				) : null}

				<div className="flex min-h-0 flex-1">
					<motion.div
						className="flex min-h-0 min-w-0 flex-1 flex-col"
						animate={{ width: "100%" }}
						transition={spring}
					>
						<div className="relative min-h-0 flex-1">
							<div
								id={transcriptScrollId}
								ref={transcriptScrollRef}
								className="mobile-custom-scroll mobile-transcript-scroll h-full min-h-0 overflow-y-auto px-4 py-0 md:px-8 md:[scrollbar-gutter:stable]"
							>
								<ThreadContentFrame className="grid gap-[var(--transcript-gap)]">
									{entries.length === 0 ? (
										isMobilePresentation ? (
											<div className="min-w-0">
												<EmptyTranscript
													hasThread={Boolean(selectedThreadId)}
													projectPath={project?.path ?? workdir}
												/>
											</div>
										) : (
											<AnimatePresence initial={false}>
												<motion.div
													key="empty-transcript"
													initial={{ opacity: 0, y: 10 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -10 }}
													transition={spring}
												>
													<EmptyTranscript
														hasThread={Boolean(selectedThreadId)}
														projectPath={project?.path ?? workdir}
													/>
												</motion.div>
											</AnimatePresence>
										)
									) : null}
									{canLoadEarlierEntries ? (
										<div className="flex justify-center">
											<button
												type="button"
												className={cn(
													"min-h-10 rounded-[8px] bg-control px-3.5 text-[12px] font-medium text-muted-strong active:bg-control-hover",
													ui.row,
												)}
												onClick={() =>
													setMobileVisibleEntryCount((current) =>
														Math.min(
															entries.length,
															current + mobileTranscriptWindowStep,
														),
													)
												}
											>
												Show {hiddenItemCount} earlier transcript{" "}
												{hiddenItemCount === 1 ? "item" : "items"}
											</button>
										</div>
									) : null}
									{isMobilePresentation ? (
										visibleEntries.map((entry) => (
											<div key={entry.id} className="min-w-0">
												{entry.kind === "process" ? (
													<ProcessOutputBlock
														entry={entry}
														wrapContent={wrapThreadContent}
													/>
												) : (
													<MessageBlock
														message={messageFromItem(entry.item)}
														wrapContent={wrapThreadContent}
													/>
												)}
											</div>
										))
									) : (
										<AnimatePresence initial={false}>
											{visibleEntries.map((entry) => (
												<motion.div
													key={entry.id}
													className="min-w-0"
													initial={{ opacity: 0, y: 10 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: -10 }}
													transition={spring}
												>
													{entry.kind === "process" ? (
														<ProcessOutputBlock
															entry={entry}
															wrapContent={wrapThreadContent}
														/>
													) : (
														<MessageBlock
															message={messageFromItem(entry.item)}
															wrapContent={wrapThreadContent}
														/>
													)}
												</motion.div>
											))}
										</AnimatePresence>
									)}
								</ThreadContentFrame>
							</div>
							<div className="chrome-edge-fade chrome-edge-fade-app chrome-edge-fade-top" />
							<div className="chrome-edge-fade chrome-edge-fade-app chrome-edge-fade-bottom chrome-edge-fade-tall" />
							{isMobilePresentation ? (
								<MobileFloatingScroller
									scrollRef={transcriptScrollRef}
									scrollElementId={transcriptScrollId}
								/>
							) : null}
						</div>

						<div
							ref={composerShellRef}
							className={cn(
								"mobile-composer-bar relative shrink-0 overflow-visible pb-0.5 pl-4 pr-[calc(1rem+var(--transcript-scrollbar-width,0px))] md:pb-0.5 md:pl-8 md:pr-[calc(2rem+var(--transcript-scrollbar-width,0px))]",
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
									onPromptFocus={settleMobilePromptFocus}
								/>
							</ThreadContentFrame>
						</div>
					</motion.div>
				</div>
			</section>
		);
	}),
);
