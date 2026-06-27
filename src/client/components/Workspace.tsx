import { AnimatePresence, motion } from "framer-motion";
import {
	Archive,
	Bot,
	Check,
	Copy,
	Ellipsis,
	FileText,
	GitFork,
	Goal,
	Image as ImageIcon,
	ListTree,
	Menu,
	Minimize2,
	Paperclip,
	Play,
	Plus,
	Search,
	Send,
	Settings,
	Square,
	SquareX,
	X,
} from "lucide-react";
import type {
	ChangeEvent,
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
	FileSearchResult,
	ThreadDetail,
	ThreadDisplayStatus,
	ThreadItem,
} from "../../server/domain.js";
import { threadDisplayStatus } from "../../server/domain.js";
import { copyToClipboard } from "../clipboard.js";
import { codexThreadCommandLabels } from "../codexCommandLabels.js";
import {
	type ComposerContextItem,
	contextDisplayName,
	newComposerContextId,
} from "../composerContext.js";
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
	composerContextItems: ComposerContextItem[];
	wrapThreadContent: boolean;
	displayScale: number;
	navigatorVisible: boolean;
	inspectorVisible: boolean;
	onPromptChange: (value: string) => void;
	onAddComposerContextItem: (item: ComposerContextItem) => void;
	onRemoveComposerContextItem: (itemId: string) => void;
	onSearchComposerFiles: (query: string) => Promise<FileSearchResult[]>;
	onComposerError: (message: string) => void;
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
const uploadTextBytesLimit = 512 * 1024;
const fileMentionSearchDebounceMs = 180;
const maxFileMentionResults = 8;

type FileMentionRange = {
	start: number;
	end: number;
	query: string;
};

function fileNameFromPath(path: string) {
	const normalized = path.replace(/\\/g, "/");
	return normalized.split("/").filter(Boolean).at(-1) ?? path;
}

function isTextUpload(file: File) {
	if (file.type.startsWith("text/")) {
		return true;
	}
	if (
		file.type === "application/json" ||
		file.type === "application/xml" ||
		file.type === "application/javascript" ||
		file.type === "application/typescript"
	) {
		return true;
	}
	return /\.(c|cc|cpp|css|csv|go|h|hpp|html|java|js|json|jsx|log|md|mdx|py|rs|sh|sql|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i.test(
		file.name,
	);
}

function readFileAsDataUrl(file: File) {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
				return;
			}
			reject(new Error(`Failed to read ${file.name}`));
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error(`Failed to read ${file.name}`));
		};
		reader.readAsDataURL(file);
	});
}

function activeFileMention(
	value: string,
	cursor: number,
): FileMentionRange | null {
	const beforeCursor = value.slice(0, cursor);
	const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
	if (!match || match.index === undefined) {
		return null;
	}
	const prefix = match[1] ?? "";
	const query = match[2] ?? "";
	const start = match.index + prefix.length;
	return {
		start,
		end: cursor,
		query,
	};
}

function contextIcon(item: ComposerContextItem) {
	if (item.type === "uploaded_image") {
		return <ImageIcon size={13} />;
	}
	return <FileText size={13} />;
}

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
	| "composerContextItems"
	| "selectedThread"
	| "selectedThreadId"
	| "onPromptChange"
	| "onAddComposerContextItem"
	| "onRemoveComposerContextItem"
	| "onSearchComposerFiles"
	| "onComposerError"
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
			composerContextItems,
			selectedThread,
			onPromptChange,
			onAddComposerContextItem,
			onRemoveComposerContextItem,
			onSearchComposerFiles,
			onComposerError,
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
		const fileInputRef = useRef<HTMLInputElement | null>(null);
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
		const [fileMentionRange, setFileMentionRange] =
			useState<FileMentionRange | null>(null);
		const [fileSearchResults, setFileSearchResults] = useState<
			FileSearchResult[]
		>([]);
		const [fileSearchLoading, setFileSearchLoading] = useState(false);
		const [fileSearchError, setFileSearchError] = useState<string | null>(null);
		const [fileSearchActiveIndex, setFileSearchActiveIndex] = useState(0);
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

		useEffect(() => {
			if (!fileMentionRange) {
				setFileSearchResults([]);
				setFileSearchLoading(false);
				setFileSearchError(null);
				setFileSearchActiveIndex(0);
				return;
			}

			const query = fileMentionRange.query.trim();
			if (!query) {
				setFileSearchResults([]);
				setFileSearchLoading(false);
				setFileSearchError(null);
				setFileSearchActiveIndex(0);
				return;
			}

			let cancelled = false;
			setFileSearchLoading(true);
			setFileSearchError(null);
			const timer = window.setTimeout(() => {
				onSearchComposerFiles(query)
					.then((results) => {
						if (cancelled) {
							return;
						}
						setFileSearchResults(results.slice(0, maxFileMentionResults));
						setFileSearchActiveIndex(0);
					})
					.catch((searchError: unknown) => {
						if (cancelled) {
							return;
						}
						setFileSearchResults([]);
						setFileSearchError(
							searchError instanceof Error
								? searchError.message
								: "Failed to search files",
						);
					})
					.finally(() => {
						if (!cancelled) {
							setFileSearchLoading(false);
						}
					});
			}, fileMentionSearchDebounceMs);

			return () => {
				cancelled = true;
				window.clearTimeout(timer);
			};
		}, [fileMentionRange, onSearchComposerFiles]);

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

		const updateFileMentionForSelection = useCallback((value: string) => {
			const textarea = textareaRef.current;
			if (!textarea) {
				setFileMentionRange(null);
				return;
			}
			const selectionStart = textarea.selectionStart ?? value.length;
			const selectionEnd = textarea.selectionEnd ?? selectionStart;
			if (selectionStart !== selectionEnd) {
				setFileMentionRange(null);
				return;
			}
			setFileMentionRange(activeFileMention(value, selectionStart));
		}, []);

		const selectFileMention = useCallback(
			(result: FileSearchResult) => {
				const range = fileMentionRange;
				if (!range) {
					return;
				}
				const before = prompt.slice(0, range.start);
				const after = prompt.slice(range.end);
				const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
				const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
				const inserted = `${needsLeadingSpace ? " " : ""}${result.path}${
					needsTrailingSpace ? " " : ""
				}`;
				const nextPrompt = `${before}${inserted}${after}`;
				const nextCursor = before.length + inserted.length;
				onPromptChange(nextPrompt);
				if (
					!composerContextItems.some(
						(item) => item.type === "file" && item.path === result.path,
					)
				) {
					onAddComposerContextItem({
						id: newComposerContextId(),
						type: "file",
						name: result.fileName || fileNameFromPath(result.path),
						path: result.path,
					});
				}
				setFileMentionRange(null);
				window.requestAnimationFrame(() => {
					const textarea = textareaRef.current;
					if (!textarea || textarea.disabled) {
						return;
					}
					textarea.focus({ preventScroll: true });
					textarea.setSelectionRange(nextCursor, nextCursor);
				});
			},
			[
				composerContextItems,
				fileMentionRange,
				onAddComposerContextItem,
				onPromptChange,
				prompt,
			],
		);

		const handlePromptChange = useCallback(
			(event: ChangeEvent<HTMLTextAreaElement>) => {
				const nextPrompt = event.target.value;
				onPromptChange(nextPrompt);
				setFileMentionRange(
					activeFileMention(nextPrompt, event.target.selectionStart),
				);
			},
			[onPromptChange],
		);

		const handlePromptKeyDown = useCallback(
			(event: KeyboardEvent<HTMLTextAreaElement>) => {
				if (fileMentionRange) {
					if (event.key === "Escape") {
						event.preventDefault();
						setFileMentionRange(null);
						return;
					}
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setFileSearchActiveIndex((index) =>
							Math.min(fileSearchResults.length - 1, index + 1),
						);
						return;
					}
					if (event.key === "ArrowUp") {
						event.preventDefault();
						setFileSearchActiveIndex((index) => Math.max(0, index - 1));
						return;
					}
					if (event.key === "Enter" && fileSearchResults.length > 0) {
						event.preventDefault();
						selectFileMention(fileSearchResults[fileSearchActiveIndex]);
						return;
					}
				}
				onPromptKeyDown(event);
			},
			[
				fileMentionRange,
				fileSearchActiveIndex,
				fileSearchResults,
				onPromptKeyDown,
				selectFileMention,
			],
		);

		const handleUploadChange = useCallback(
			(event: ChangeEvent<HTMLInputElement>) => {
				const files = Array.from(event.target.files ?? []);
				event.target.value = "";
				if (files.length === 0) {
					return;
				}
				void (async () => {
					const errors: string[] = [];
					for (const file of files) {
						try {
							if (file.type.startsWith("image/")) {
								const dataUrl = await readFileAsDataUrl(file);
								onAddComposerContextItem({
									id: newComposerContextId(),
									type: "uploaded_image",
									name: file.name,
									mimeType: file.type || "application/octet-stream",
									dataUrl,
								});
								continue;
							}
							if (!isTextUpload(file)) {
								errors.push(
									`${file.name} is not a supported text or image file`,
								);
								continue;
							}
							if (file.size > uploadTextBytesLimit) {
								errors.push(
									`${file.name} is larger than ${Math.round(
										uploadTextBytesLimit / 1024,
									)}KB`,
								);
								continue;
							}
							onAddComposerContextItem({
								id: newComposerContextId(),
								type: "uploaded_text",
								name: file.name,
								mimeType: file.type || null,
								text: await file.text(),
							});
						} catch (uploadError) {
							errors.push(
								uploadError instanceof Error
									? uploadError.message
									: `Failed to read ${file.name}`,
							);
						}
					}
					if (errors.length > 0) {
						onComposerError(errors.join("; "));
					}
				})();
			},
			[onAddComposerContextItem, onComposerError],
		);

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
					<div className={cn(ui.composerShell, "relative")}>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							className="hidden"
							onChange={handleUploadChange}
						/>
						{composerContextItems.length > 0 ? (
							<div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto pr-1">
								{composerContextItems.map((item) => (
									<span
										key={item.id}
										className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-border bg-control px-2 py-1 text-[11px] leading-4 text-fg shadow-control"
										title={contextDisplayName(item)}
									>
										<span className="shrink-0 text-muted" aria-hidden="true">
											{contextIcon(item)}
										</span>
										<span className="min-w-0 max-w-[16rem] truncate">
											{contextDisplayName(item)}
										</span>
										<button
											type="button"
											className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-muted transition hover:bg-control-hover hover:text-fg-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
											title="Remove context"
											aria-label={`Remove ${contextDisplayName(item)}`}
											onClick={() => onRemoveComposerContextItem(item.id)}
										>
											<X size={11} />
										</button>
									</span>
								))}
							</div>
						) : null}
						<textarea
							ref={textareaRef}
							className={cn(
								ui.textarea,
								"max-h-[160px] min-h-[34px] px-0.5 py-0.5 text-[length:var(--composer-font-size)] leading-[var(--composer-line-height)]",
							)}
							value={prompt}
							onChange={handlePromptChange}
							onKeyDown={handlePromptKeyDown}
							onSelect={() => updateFileMentionForSelection(prompt)}
							onFocus={(event) => {
								onPromptFocus?.();
								setFileMentionRange(
									activeFileMention(prompt, event.target.selectionStart),
								);
							}}
							placeholder={placeholder}
							disabled={busy}
							autoCapitalize="sentences"
							autoCorrect="on"
							spellCheck={true}
						/>
						<AnimatePresence>
							{fileMentionRange ? (
								<motion.div
									className="absolute bottom-[3.45rem] left-3.5 right-3.5 z-30 max-h-64 overflow-hidden rounded-[12px] border border-border bg-detail shadow-popover"
									role="listbox"
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 6 }}
									transition={spring}
								>
									<div className="flex h-9 items-center gap-2 border-b border-border px-3 text-[12px] text-muted">
										<Search size={13} />
										<span className="min-w-0 truncate">
											{fileMentionRange.query.trim()
												? `Search files for "${fileMentionRange.query}"`
												: "Type after @ to search files"}
										</span>
									</div>
									<div className="max-h-52 overflow-y-auto p-1">
										{fileSearchLoading ? (
											<div className="px-3 py-3 text-[12px] text-muted">
												Searching...
											</div>
										) : fileSearchError ? (
											<div className="px-3 py-3 text-[12px] text-rose-200">
												{fileSearchError}
											</div>
										) : fileSearchResults.length === 0 ? (
											<div className="px-3 py-3 text-[12px] text-muted">
												No files found
											</div>
										) : (
											fileSearchResults.map((result, index) => (
												<button
													key={`${result.root}:${result.path}`}
													type="button"
													role="option"
													aria-selected={index === fileSearchActiveIndex}
													className={cn(
														"flex h-11 w-full min-w-0 items-center gap-2 rounded-[8px] px-2 text-left transition duration-150 ease-out hover:bg-control",
														index === fileSearchActiveIndex
															? "bg-selected text-fg-strong"
															: "text-fg",
													)}
													onMouseEnter={() => setFileSearchActiveIndex(index)}
													onMouseDown={(event) => event.preventDefault()}
													onClick={() => selectFileMention(result)}
												>
													<FileText size={14} className="shrink-0 text-muted" />
													<span className="min-w-0 flex-1">
														<span className="block truncate text-[12px] font-medium">
															{result.fileName || fileNameFromPath(result.path)}
														</span>
														<span className="block truncate text-[11px] text-muted">
															{result.path}
														</span>
													</span>
												</button>
											))
										)}
									</div>
								</motion.div>
							) : null}
						</AnimatePresence>
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
									title="Attach files"
									aria-label="Attach files"
									disabled={busy}
									onClick={() => fileInputRef.current?.click()}
								>
									<Paperclip size={14} />
								</ComposerIconButton>
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
			composerContextItems,
			onPromptChange,
			onAddComposerContextItem,
			onRemoveComposerContextItem,
			onSearchComposerFiles,
			onComposerError,
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
									composerContextItems={composerContextItems}
									onPromptChange={onPromptChange}
									onAddComposerContextItem={onAddComposerContextItem}
									onRemoveComposerContextItem={onRemoveComposerContextItem}
									onSearchComposerFiles={onSearchComposerFiles}
									onComposerError={onComposerError}
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
