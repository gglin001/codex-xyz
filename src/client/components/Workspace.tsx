import { AnimatePresence, motion } from "framer-motion";
import {
	Archive,
	Bot,
	Check,
	Copy,
	Ellipsis,
	GitFork,
	Goal,
	ListTree,
	Menu,
	Minimize2,
	Play,
	Plus,
	Send,
	Settings,
	Square,
	SquareX,
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
import { cn, tone, ui } from "../designSystem.js";
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
import { useSwipeGesture } from "../useSwipeGesture.js";
import {
	CollapsibleCard,
	ComposerIconButton,
	CopyIconButton,
	FieldShell,
	LargeIconButton,
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
	navigatorVisible: boolean;
	inspectorVisible: boolean;
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
	onSwipeUp?: () => void;
};

export type WorkspaceHandle = {
	focusPrompt: () => boolean;
};

type ComposerHandle = {
	focusPrompt: () => boolean;
};

type ChatMessage = {
	id: string;
	name: string;
	text: string;
	copyText: string;
	time: string;
};

const spring = { type: "spring", stiffness: 340, damping: 34 } as const;
const threadContentWidthClass = "[--thread-content-width:900px]";
const threadContentFrameClass =
	"mx-auto w-full min-w-0 max-w-[var(--thread-content-width)]";
const mobileHandleClass = "h-1 w-14 rounded-full bg-border-strong";
const mobileComposerSwipeAxisLockRatio = 1.15;
const mobileComposerSwipeDirectionThresholds = {
	up: 88,
};
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
		return "border-accent-soft bg-selected/35";
	}
	if (name === "Response") {
		return "border-border bg-detail/70";
	}
	return "border-border bg-app-bg/60";
}

function headerMeta(value: string) {
	return (
		<span className="block min-w-0 truncate whitespace-nowrap text-[11px] text-muted">
			{value}
		</span>
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
				className={cn(
					"inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
					buttonClassName,
				)}
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
			className="bg-app-bg/55 shadow-none"
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
			className="border-border bg-surface-subtle/80"
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
		<div className="rounded-[12px] border border-dashed border-border bg-detail/45 px-5 py-8 text-center">
			<div
				className={cn(
					"mx-auto mb-4 h-10 w-10 border border-border text-muted-strong",
					ui.iconBox,
				)}
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
	onSwipeUp?: () => void;
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
			onSwipeUp,
		},
		ref,
	) {
		const textareaRef = useRef<HTMLTextAreaElement | null>(null);
		const actionBarRef = useRef<HTMLDivElement | null>(null);
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
			textarea.style.height = "0px";
			textarea.style.height = `${Math.min(160, Math.max(30, textarea.scrollHeight))}px`;
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

		useSwipeGesture(
			actionBarRef,
			{ onSwipeUp },
			{
				axisLockRatio: mobileComposerSwipeAxisLockRatio,
				directionThresholds: mobileComposerSwipeDirectionThresholds,
			},
		);

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
								buttonClassName="text-current opacity-70 hover:bg-emerald-300/10 hover:opacity-100"
								dismissLabel="Dismiss notice"
							/>
						) : null}
						{error ? (
							<DismissibleAlert
								message={error}
								onDismiss={onDismissError}
								toneClass={tone.error.alert}
								buttonClassName="text-current opacity-70 hover:bg-rose-300/10 hover:opacity-100"
								dismissLabel="Dismiss error"
								role="alert"
							/>
						) : null}
					</div>
				) : null}

				{promptTarget === "new" ? (
					<FieldShell className="mb-3 h-9 px-3">
						<div className="workdir-input-scroll min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
							<input
								className={cn(
									ui.input,
									"block min-w-full flex-none whitespace-nowrap font-mono text-[12px] text-fg",
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
								"max-h-[160px] min-h-[34px] px-0.5 py-0.5 text-[length:var(--composer-font-size)] leading-[var(--composer-line-height)]",
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
						<div
							ref={actionBarRef}
							className="relative flex items-center justify-between gap-3 border-t border-border pt-2"
						>
							<span
								className={cn(
									"pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 md:hidden",
									mobileHandleClass,
								)}
								aria-hidden="true"
							/>
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
								<div className="relative z-10">
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
													className="fixed inset-0 z-10"
													initial={{ opacity: 0 }}
													animate={{ opacity: 1 }}
													exit={{ opacity: 0 }}
													onClick={() => setMoreActionsOpen(false)}
												/>
												<motion.div
													className="absolute bottom-full left-0 z-20 mb-2 w-44 rounded-[12px] border border-border bg-detail shadow-popover"
													role="menu"
													initial={{ opacity: 0, y: 6 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: 6 }}
													transition={spring}
												>
													<div className="p-1">
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canArchive}
															onClick={() => {
																onArchive();
																setMoreActionsOpen(false);
															}}
														>
															<Archive
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.archive}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canCompact}
															onClick={() => {
																onCompact();
																setMoreActionsOpen(false);
															}}
														>
															<Minimize2
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.compact}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canInterrupt}
															onClick={() => {
																onInterrupt();
																setMoreActionsOpen(false);
															}}
														>
															<Square
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.interrupt}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canFork}
															onClick={() => {
																onFork();
																setMoreActionsOpen(false);
															}}
														>
															<GitFork
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.fork}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canUseBackgroundTerminals}
															onClick={() => {
																onListBackgroundTerminals();
																setMoreActionsOpen(false);
															}}
														>
															<ListTree
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.ps}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canUseBackgroundTerminals}
															onClick={() => {
																onCleanBackgroundTerminals();
																setMoreActionsOpen(false);
															}}
														>
															<SquareX
																size={15}
																className="shrink-0 text-muted"
															/>
															<span>{codexThreadCommandLabels.stop}</span>
														</button>
														<button
															type="button"
															role="menuitem"
															className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
															disabled={!canResume}
															onClick={() => {
																onResume();
																setMoreActionsOpen(false);
															}}
														>
															<Play size={15} className="shrink-0 text-muted" />
															<span>{codexThreadCommandLabels.resume}</span>
														</button>
													</div>
												</motion.div>
											</>
										) : null}
									</AnimatePresence>
								</div>
							</div>
							<button
								type="submit"
								className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-accent-soft bg-accent text-accent-fg shadow-control transition duration-150 ease-out hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-control disabled:text-muted disabled:opacity-45"
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
			navigatorVisible,
			inspectorVisible,
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
			onSwipeUp,
		},
		ref,
	) {
		const composerRef = useRef<ComposerHandle | null>(null);
		const composerShellRef = useRef<HTMLDivElement | null>(null);
		const rootRef = useRef<HTMLElement | null>(null);
		const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
		const mobileTranscriptDetailIdRef = useRef<string | null>(null);
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
		const subtitle =
			selectedThread?.cwd ??
			threadSummary?.cwd ??
			project?.path ??
			"Select a project to begin";
		const tokens = detail?.tokensUsed ?? threadSummary?.tokensUsed ?? 0;
		const status = selectedThread
			? threadDisplayStatus(selectedThread)
			: (threadSummary?.status ?? "idle");
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
				<header className="hidden md:flex md:relative z-[110] md:h-14 shrink-0 items-center justify-between gap-3 border-b border-border md:bg-app-bg/95 md:px-5">
					<div className="flex min-w-0 items-center gap-3">
						<LargeIconButton
							title={navigatorVisible ? "Hide threads" : "Open threads"}
							aria-label={navigatorVisible ? "Hide threads" : "Open threads"}
							pressed={navigatorVisible}
							onClick={onToggleNavigator}
						>
							<Menu size={15} />
						</LargeIconButton>
						<div className="grid min-w-0 gap-0.5">
							<h1 className="truncate text-[15px] font-semibold leading-5 text-fg-strong">
								{name}
							</h1>
							<div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
								<span className="truncate">{subtitle}</span>
								<span className="hidden h-3 border-l border-border sm:inline" />
								<span className="hidden shrink-0 sm:inline">
									{formatTokens(tokens)} tokens
								</span>
								<span className="hidden h-3 border-l border-border sm:inline" />
								<span className="inline-flex shrink-0 items-center gap-1.5 text-muted-strong">
									<span
										className={cn(
											"h-1.5 w-1.5 rounded-full",
											statusDotClass(status),
										)}
									/>
									<span>{statusLabel(status)}</span>
								</span>
							</div>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<LargeIconButton
							title={inspectorVisible ? "Hide settings" : "Open settings"}
							aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
							pressed={inspectorVisible}
							onClick={onToggleInspector}
						>
							<Settings size={15} />
						</LargeIconButton>
					</div>
				</header>

				<div className="flex min-h-0 flex-1">
					<motion.div
						className="flex min-h-0 min-w-0 flex-1 flex-col"
						animate={{ width: "100%" }}
						transition={spring}
					>
						<div
							ref={transcriptScrollRef}
							className="mobile-transcript-scroll min-h-0 flex-1 overflow-y-auto scroll-mask-y-t px-4 pt-[calc(var(--safe-inset-top)+1rem)] [scrollbar-gutter:stable] md:px-8 md:pb-5 md:pt-5"
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
												"min-h-10 rounded-[8px] border border-border bg-control px-3.5 text-[12px] font-medium text-muted-strong active:bg-control-hover",
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

						<div
							ref={composerShellRef}
							className="mobile-composer-bar relative z-[80] shrink-0 overflow-visible border-t border-border bg-app-bg/95 pl-4 pr-[calc(1rem+var(--transcript-scrollbar-width,0px))] pt-2 md:pl-8 md:pr-[calc(2rem+var(--transcript-scrollbar-width,0px))] md:pb-3"
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
									onSwipeUp={onSwipeUp}
								/>
							</ThreadContentFrame>
						</div>
					</motion.div>
				</div>
			</section>
		);
	}),
);
