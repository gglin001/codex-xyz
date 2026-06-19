import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Maximize2,
  Menu,
  PanelLeftClose,
  Play,
  Plus,
  Send,
  SlidersHorizontal,
  Square,
  X
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { ControlThread, ThreadDetail, ThreadItem } from "../../server/domain.js"
import { cn } from "../classNames.js"
import { getFirstLineTextPreview } from "../textPreview.js"
import { getTranscriptEntries, type TranscriptProcessEntry } from "../transcriptEntries.js"
import { formatDateTime, formatTime, formatTokens, itemTitle, statusLabel } from "../uiFormat.js"
import type { ComposerMode, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

export type WorkspaceProps = {
  project: WorkbenchProject | null
  session: WorkbenchSession | null
  detail: ThreadDetail | null
  selectedThread: ControlThread | null
  selectedThreadId: string | null
  workdir: string
  busy: boolean
  busyAction: string | null
  notice: string | null
  error: string | null
  prompt: string
  promptTarget: ComposerMode
  goalMode: boolean
  canUseGoalMode: boolean
  canSubmitPrompt: boolean
  wrapSessionContent: boolean
  navigatorVisible: boolean
  inspectorVisible: boolean
  onPromptChange: (value: string) => void
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPromptSubmit: (event: FormEvent) => void
  onModeChange: (mode: ComposerMode) => void
  onWorkdirChange: (value: string) => void
  onGoalModeChange: (value: boolean) => void
  onInterrupt: () => void
  onResume: () => void
  onToggleNavigator: () => void
  onToggleInspector: () => void
}

export type WorkspaceHandle = {
  focusPrompt: () => boolean
}

type ComposerHandle = {
  focusPrompt: () => boolean
}

type CodeBlock = {
  id: string
  language: string
  code: string
  title: string
}

type ChatMessage = {
  id: string
  title: string
  text: string
  time: string
  codeBlocks: CodeBlock[]
}

const spring = { type: "spring", stiffness: 340, damping: 34 } as const
const sessionContentWidthClass = "[--session-content-width:860px]"
const sessionContentFrameClass = "mx-auto w-full min-w-0 max-w-[var(--session-content-width)]"

function SessionContentFrame({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(sessionContentFrameClass, className)}>
      {children}
    </div>
  )
}

function extractCodeBlocks(item: ThreadItem) {
  const blocks: CodeBlock[] = []
  const text = item.text ?? ""
  const fencePattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let index = 0
  while ((match = fencePattern.exec(text)) !== null) {
    const language = match[1] || "text"
    const code = match[2]?.trimEnd() ?? ""
    if (code.trim()) {
      blocks.push({
        id: `${item.id}:fence:${index}`,
        language,
        code,
        title: `${itemTitle(item)} ${index + 1}`
      })
      index += 1
    }
  }

  if (blocks.length === 0 && item.type === "command" && text.trim()) {
    const command = typeof item.data.command === "string" ? item.data.command : "command output"
    blocks.push({
      id: `${item.id}:command`,
      language: "bash",
      code: text.trimEnd(),
      title: command
    })
  }

  return blocks
}

function stripCodeFences(value: string) {
  return value.replace(/```([a-zA-Z0-9_-]+)?\n[\s\S]*?```/g, "").trim()
}

function messageFromItem(item: ThreadItem): ChatMessage {
  const codeBlocks = extractCodeBlocks(item)
  const stripped = stripCodeFences(item.text)
  return {
    id: item.id,
    title: itemTitle(item),
    text: stripped || item.text || "Pending...",
    time: item.createdAt,
    codeBlocks
  }
}

function transcriptEntriesFromDetail(detail: ThreadDetail | null) {
  return detail ? getTranscriptEntries(detail.items) : []
}

function processPreview(entry: TranscriptProcessEntry) {
  const firstText = entry.items.find((item) => item.text.trim())?.text ?? ""
  const stripped = stripCodeFences(firstText).trim()
  return getFirstLineTextPreview(stripped || firstText.trim() || "No output yet")
}

function codePreview(value: string) {
  const lines = value.split(/\r?\n/)
  return lines.slice(0, 12).join("\n")
}

const CodeBlockView = memo(function CodeBlockView({
  block,
  active,
  wrapContent,
  onOpenCanvas
}: {
  block: CodeBlock
  active: boolean
  wrapContent: boolean
  onOpenCanvas: (block: CodeBlock) => void
}) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const copyCode = useCallback(() => {
    void navigator.clipboard?.writeText(block.code)
    setCopied(true)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => setCopied(false), 1200)
  }, [block.code])

  return (
    <div className={cn("overflow-hidden rounded-md border bg-slate-950/85", active ? "border-emerald-500/45" : "border-slate-800/80")}>
      <div className="flex h-9 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/70 px-3">
        <div className="min-w-0">
          <span className="block truncate font-mono text-[12px] text-slate-300">{block.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition duration-150 ease-out hover:bg-slate-800 hover:text-slate-100"
            title="Copy"
            aria-label="Copy"
            onClick={copyCode}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded transition duration-150 ease-out hover:bg-slate-800 hover:text-slate-100",
              active ? "text-emerald-300" : "text-slate-500"
            )}
            title="Open in Canvas"
            aria-label="Open in Canvas"
            onClick={() => onOpenCanvas(block)}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <pre className={cn(
        "max-h-[320px] overflow-auto p-3 font-mono text-[12px] leading-5 text-slate-300",
        wrapContent ? "whitespace-pre-wrap break-words" : "whitespace-pre"
      )}>
        <code>{codePreview(block.code)}</code>
      </pre>
    </div>
  )
})

const MessageBlock = memo(function MessageBlock({
  message,
  activeBlockId,
  wrapContent,
  onOpenCanvas
}: {
  message: ChatMessage
  activeBlockId: string | null
  wrapContent: boolean
  onOpenCanvas: (block: CodeBlock) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const codeBlockLabel = message.codeBlocks.length > 0
    ? ` / ${message.codeBlocks.length} ${message.codeBlocks.length === 1 ? "block" : "blocks"}`
    : ""
  const preview = getFirstLineTextPreview(message.text || "Pending...")

  return (
    <article className="group min-w-0 border-b border-slate-800/45 pb-5">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1 text-left transition duration-150 ease-out hover:bg-slate-900/35"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0">
          <span className="mb-1 flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-slate-100">{message.title}</span>
            <time className="shrink-0 text-[11px] text-slate-600">{formatTime(message.time)}{codeBlockLabel}</time>
          </span>
          {!expanded ? (
            <span className="block truncate text-[12px] leading-5 text-slate-500">{preview}</span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          className={cn("mt-0.5 shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
        />
      </button>

      {expanded ? (
        <div className="mt-2 min-w-0 px-2">
          {message.text ? (
            <div className={cn(
              "text-[14px] leading-6 text-slate-300",
              wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
            )}>{message.text}</div>
          ) : null}
          {message.codeBlocks.length > 0 ? (
            <div className="mt-3 grid gap-3">
              {message.codeBlocks.map((block) => (
                <CodeBlockView
                  key={block.id}
                  block={block}
                  active={activeBlockId === block.id}
                  wrapContent={wrapContent}
                  onOpenCanvas={onOpenCanvas}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
})

const ProcessItemBlock = memo(function ProcessItemBlock({
  message,
  activeBlockId,
  wrapContent,
  onOpenCanvas
}: {
  message: ChatMessage
  activeBlockId: string | null
  wrapContent: boolean
  onOpenCanvas: (block: CodeBlock) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const codeBlockLabel = message.codeBlocks.length > 0
    ? ` / ${message.codeBlocks.length} ${message.codeBlocks.length === 1 ? "block" : "blocks"}`
    : ""
  const preview = getFirstLineTextPreview(message.text || "Pending...")

  return (
    <div className="min-w-0 rounded-md border border-slate-800/75 bg-slate-950/45">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition duration-150 ease-out hover:bg-slate-900/65"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold text-slate-200">{message.title}</span>
            <span className="block truncate text-[11px] text-slate-600">
              {formatTime(message.time)}{codeBlockLabel}
            </span>
            {!expanded ? (
              <span className="block truncate text-[12px] leading-5 text-slate-500">{preview}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn("shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
        />
      </button>

      {expanded ? (
        <div className="min-w-0 border-t border-slate-800/60 p-3">
          {message.text ? (
            <div className={cn(
              "text-[13px] leading-5 text-slate-300",
              wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
            )}>{message.text}</div>
          ) : null}
          {message.codeBlocks.length > 0 ? (
            <div className="mt-3 grid gap-3">
              {message.codeBlocks.map((block) => (
                <CodeBlockView
                  key={block.id}
                  block={block}
                  active={activeBlockId === block.id}
                  wrapContent={wrapContent}
                  onOpenCanvas={onOpenCanvas}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

const ProcessOutputBlock = memo(function ProcessOutputBlock({
  entry,
  activeBlockId,
  wrapContent,
  onOpenCanvas
}: {
  entry: TranscriptProcessEntry
  activeBlockId: string | null
  wrapContent: boolean
  onOpenCanvas: (block: CodeBlock) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const messages = useMemo(() => entry.items.map(messageFromItem), [entry.items])
  const codeBlockCount = messages.reduce((count, message) => count + message.codeBlocks.length, 0)
  const itemCountLabel = `${entry.items.length} ${entry.items.length === 1 ? "event" : "events"}`
  const codeCountLabel = codeBlockCount > 0 ? ` / ${codeBlockCount} ${codeBlockCount === 1 ? "block" : "blocks"}` : ""
  const preview = useMemo(() => processPreview(entry), [entry])

  return (
    <article className="group min-w-0 border-b border-slate-800/45 pb-5">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-800/80 bg-slate-900/35 px-3 py-2.5 text-left transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/55"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-slate-100">Intermediate output</span>
          <span className="block truncate text-[11px] text-slate-500">
            {itemCountLabel}{codeCountLabel} / {formatTime(entry.createdAt)}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
        />
      </button>

      {!expanded ? (
        <div className="mt-2 truncate px-1 text-[12px] leading-5 text-slate-500">{preview}</div>
      ) : (
        <div className="mt-3 grid min-w-0 gap-3">
          {messages.map((message) => (
            <ProcessItemBlock
              key={message.id}
              message={message}
              activeBlockId={activeBlockId}
              wrapContent={wrapContent}
              onOpenCanvas={onOpenCanvas}
            />
          ))}
        </div>
      )}
    </article>
  )
})

const EmptyTranscript = memo(function EmptyTranscript({
  hasThread,
  projectPath
}: {
  hasThread: boolean
  projectPath: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800/80 bg-slate-900/25 px-4 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-slate-500">
        <Bot size={18} />
      </div>
      <h2 className="text-[14px] font-semibold text-slate-200">
        {hasThread ? "Waiting for Codex transcript" : "No Codex session selected"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-slate-500">
        {hasThread
          ? "This app-server thread has no persisted transcript items yet. Send a prompt or resume the session to continue."
          : `Create a Codex app-server session for ${projectPath} or select an existing thread from the navigator.`}
      </p>
    </div>
  )
})

const CanvasPane = memo(function CanvasPane({
  block,
  onClose
}: {
  block: CodeBlock
  onClose: () => void
}) {
  return (
    <motion.aside
      className="hidden min-h-0 border-l border-slate-800/80 bg-slate-950/85 lg:flex lg:flex-col"
      initial={{ opacity: 0, width: 0 }}
      animate={{ opacity: 1, width: "50%" }}
      exit={{ opacity: 0, width: 0 }}
      transition={spring}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/75 px-4 backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-slate-100">{block.title}</h2>
          <p className="truncate text-[11px] text-slate-500">Transcript source / {block.language}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100"
          title="Close Canvas"
          aria-label="Close Canvas"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-slate-600">
          <span>Source</span>
          <span>{block.code.split(/\r?\n/).length} lines</span>
        </div>
        <pre className="min-h-full rounded-md border border-slate-800/80 bg-[#050608] p-4 font-mono text-[12px] leading-6 text-slate-300 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <code>{block.code}</code>
        </pre>
      </div>
    </motion.aside>
  )
})

type ComposerProps = Pick<
  WorkspaceProps,
  | "workdir"
  | "busy"
  | "busyAction"
  | "notice"
  | "error"
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
>

const Composer = memo(forwardRef<ComposerHandle, ComposerProps>(function Composer({
  workdir,
  busy,
  busyAction,
  notice,
  error,
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
  onResume
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canInterrupt = selectedThread?.status === "running" && !busy
  const canResume = Boolean(selectedThreadId) && selectedThread?.status !== "running" && !busy
  const submitTitle = goalMode ? "Start goal mode" : promptTarget === "thread" ? "Send prompt" : "Create session"
  const placeholder = goalMode
    ? "Describe the goal objective"
    : promptTarget === "thread"
      ? "Ask Codex to continue this session"
      : "Start a new Codex session"

  useImperativeHandle(ref, () => ({
    focusPrompt: () => {
      const textarea = textareaRef.current
      if (!textarea || textarea.disabled) {
        return false
      }
      textarea.focus({ preventScroll: true })
      const caret = textarea.value.length
      textarea.setSelectionRange(caret, caret)
      return true
    }
  }), [])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = "0px"
    textarea.style.height = `${Math.min(220, Math.max(52, textarea.scrollHeight))}px`
  }, [prompt])

  const focusPromptOnNextFrame = useCallback(() => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea || textarea.disabled) {
        return
      }
      textarea.focus({ preventScroll: true })
      const caret = textarea.value.length
      textarea.setSelectionRange(caret, caret)
    })
  }, [])

  return (
    <div>
      {(busyAction || notice || error) ? (
        <div className="mb-2 grid gap-1.5 text-[12px]">
          {busyAction ? <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-slate-300">{busyAction}...</div> : null}
          {notice ? <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-emerald-100">{notice}</div> : null}
          {error ? <div className="rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-rose-100">{error}</div> : null}
        </div>
      ) : null}

      {promptTarget === "new" ? (
        <label className="mb-2 flex h-9 items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/70 px-3 text-slate-500 transition duration-150 ease-out focus-within:border-slate-700 focus-within:text-slate-300">
          <Code2 size={15} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
            value={workdir}
            onChange={(event) => onWorkdirChange(event.target.value)}
            placeholder="/path/to/repo"
            disabled={busy}
            aria-label="Working directory"
          />
        </label>
      ) : null}

      <form onSubmit={onPromptSubmit}>
        <div className="overflow-hidden rounded-lg border border-slate-800/90 bg-slate-900/55 shadow-2xl shadow-black/20 transition duration-150 ease-out focus-within:border-slate-700 focus-within:ring-2 focus-within:ring-emerald-500/10">
          <textarea
            ref={textareaRef}
            className="block max-h-[220px] min-h-[52px] w-full resize-none border-0 bg-transparent px-4 py-3 text-[14px] leading-6 text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder={placeholder}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-2 border-t border-slate-800/70 bg-slate-950/40 px-2 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100",
                  promptTarget === "new" ? "bg-slate-800/70 text-slate-100" : null
                )}
                title="New session"
                aria-label="New session"
                aria-pressed={promptTarget === "new"}
                disabled={busy}
                onClick={() => {
                  onModeChange(promptTarget === "new" && selectedThreadId ? "thread" : "new")
                  focusPromptOnNextFrame()
                }}
              >
                <Plus size={15} />
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 min-w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35",
                  goalMode ? "bg-emerald-500/10 text-emerald-200" : null
                )}
                title="Goal mode"
                aria-label="Goal mode"
                aria-pressed={goalMode}
                disabled={!canUseGoalMode || busy}
                onClick={() => onGoalModeChange(!goalMode)}
              >
                <Code2 size={15} />
              </button>
              <button
                type="button"
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                title="Interrupt"
                aria-label="Interrupt"
                disabled={!canInterrupt}
                onClick={onInterrupt}
              >
                <Square size={15} />
              </button>
              <button
                type="button"
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                title="Resume"
                aria-label="Resume"
                disabled={!canResume}
                onClick={onResume}
              >
                <Play size={15} />
              </button>
            </div>
            <button
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-md bg-emerald-500 px-2 text-slate-950 transition duration-150 ease-out hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
              disabled={!canSubmitPrompt}
              title={submitTitle}
              aria-label={submitTitle}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}))

export const Workspace = memo(forwardRef<WorkspaceHandle, WorkspaceProps>(function Workspace({
  project,
  session,
  detail,
  selectedThread,
  selectedThreadId,
  workdir,
  busy,
  busyAction,
  notice,
  error,
  prompt,
  promptTarget,
  goalMode,
  wrapSessionContent,
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
  onToggleNavigator,
  onToggleInspector
}, ref) {
  const [canvasBlock, setCanvasBlock] = useState<CodeBlock | null>(null)
  const composerRef = useRef<ComposerHandle | null>(null)
  const entries = useMemo(() => transcriptEntriesFromDetail(detail), [detail])
  const title = selectedThread?.title ?? session?.title ?? "New Codex session"
  const subtitle = selectedThread?.cwd ?? session?.cwd ?? project?.path ?? "Select a project to begin"
  const tokens = detail?.tokensUsed ?? session?.tokensUsed ?? 0
  const status = selectedThread?.status ?? session?.status ?? "idle"

  useImperativeHandle(ref, () => ({
    focusPrompt: () => composerRef.current?.focusPrompt() ?? false
  }), [])

  useEffect(() => {
    setCanvasBlock(null)
  }, [selectedThreadId, session?.id])

  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col bg-slate-950 text-slate-200", sessionContentWidthClass)}>
      <header className="relative z-[110] flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/75 px-3 backdrop-blur-md md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800/80 text-slate-400 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100",
              navigatorVisible ? "bg-slate-800/70 text-slate-100" : "bg-slate-900/50"
            )}
            title={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-label={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-pressed={navigatorVisible}
            onClick={onToggleNavigator}
          >
            {navigatorVisible ? <PanelLeftClose size={17} /> : <Menu size={17} />}
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-slate-100">{title}</h1>
            <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 rounded-md border border-slate-800/80 bg-slate-900/45 px-2.5 py-1.5 text-[11px] text-slate-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>{statusLabel(status)}</span>
            <span className="text-slate-700">/</span>
            <span>{formatTokens(tokens)} tokens</span>
          </div>
          <button
            type="button"
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800/80 text-slate-400 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100",
              inspectorVisible ? "bg-slate-800/70 text-slate-100" : "bg-slate-900/50"
            )}
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-pressed={inspectorVisible}
            onClick={onToggleInspector}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <motion.div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          animate={{ width: canvasBlock ? "50%" : "100%" }}
          transition={spring}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
            <SessionContentFrame className="grid gap-5">
              <div className="grid gap-2 border-b border-slate-800/50 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-slate-600">
                  <span>{project?.name ?? "Workspace"}</span>
                  <span>/</span>
                  <span>{detail ? formatDateTime(detail.updatedAt) : "app-server"}</span>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {entries.length === 0 ? (
                  <motion.div
                    key="empty-transcript"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={spring}
                  >
                    <EmptyTranscript hasThread={Boolean(selectedThreadId)} projectPath={project?.path ?? workdir} />
                  </motion.div>
                ) : null}
                {entries.map((entry) => (
                  <motion.div
                    key={entry.id}
                    layout
                    className="min-w-0"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={spring}
                  >
                    {entry.kind === "process" ? (
                      <ProcessOutputBlock
                        entry={entry}
                        activeBlockId={canvasBlock?.id ?? null}
                        wrapContent={wrapSessionContent}
                        onOpenCanvas={setCanvasBlock}
                      />
                    ) : (
                      <MessageBlock
                        message={messageFromItem(entry.item)}
                        activeBlockId={canvasBlock?.id ?? null}
                        wrapContent={wrapSessionContent}
                        onOpenCanvas={setCanvasBlock}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </SessionContentFrame>
          </div>

          <div className="shrink-0 border-t border-slate-800/80 bg-slate-950/75 px-4 py-3 backdrop-blur-md md:px-8">
            <SessionContentFrame>
              <Composer
                ref={composerRef}
                workdir={workdir}
                busy={busy}
                busyAction={busyAction}
                notice={notice}
                error={error}
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
              />
            </SessionContentFrame>
          </div>
        </motion.div>

        <AnimatePresence>
          {canvasBlock ? <CanvasPane key={canvasBlock.id} block={canvasBlock} onClose={() => setCanvasBlock(null)} /> : null}
        </AnimatePresence>
      </div>
    </section>
  )
}))
