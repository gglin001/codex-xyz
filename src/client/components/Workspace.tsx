import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Menu,
  PanelLeftClose,
  Play,
  Plus,
  Send,
  SlidersHorizontal,
  Square
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

type ChatMessage = {
  id: string
  title: string
  text: string
  copyText: string
  time: string
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

function messageFromItem(item: ThreadItem): ChatMessage {
  const fallbackText = item.text || "Pending..."
  return {
    id: item.id,
    title: itemTitle(item),
    text: fallbackText,
    copyText: fallbackText,
    time: item.createdAt
  }
}

function transcriptEntriesFromDetail(detail: ThreadDetail | null) {
  return detail ? getTranscriptEntries(detail.items) : []
}

function processPreview(entry: TranscriptProcessEntry) {
  const firstText = entry.items.find((item) => item.text.trim())?.text ?? ""
  return getFirstLineTextPreview(firstText.trim() || "No output yet")
}

function messageMeta(message: ChatMessage) {
  return formatTime(message.time)
}

const CopyTextButton = memo(function CopyTextButton({
  value,
  label = "Copy"
}: {
  value: string
  label?: string
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

  const copyValue = useCallback(() => {
    void navigator.clipboard?.writeText(value)
    setCopied(true)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => setCopied(false), 1200)
  }, [value])

  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 transition duration-150 ease-out hover:bg-slate-800 hover:text-slate-100"
      title={label}
      aria-label={label}
      onClick={copyValue}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
})

const MessageBlock = memo(function MessageBlock({
  message,
  wrapContent
}: {
  message: ChatMessage
  wrapContent: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const preview = getFirstLineTextPreview(message.text || "Pending...")

  return (
    <article className="group min-w-0 border-b border-slate-800/45 pb-5">
      <div className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 transition duration-150 ease-out hover:bg-slate-900/35">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-100">{message.title}</span>
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="whitespace-nowrap text-[11px] text-slate-600">{messageMeta(message)}</span>
          <CopyTextButton value={message.copyText} />
        </div>
      </div>
      {!expanded ? (
        <div className="px-2">
          <div className="truncate text-[12px] leading-5 text-slate-500">{preview}</div>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2 min-w-0 px-2">
          {message.text ? (
            <div className={cn(
              "text-[14px] leading-6 text-slate-300",
              wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
          )}>{message.text}</div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
})

const ProcessItemBlock = memo(function ProcessItemBlock({
  message,
  wrapContent
}: {
  message: ChatMessage
  wrapContent: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = getFirstLineTextPreview(message.text || "Pending...")

  return (
    <div className="min-w-0 rounded-md border border-slate-800/75 bg-slate-950/45">
      <div className="flex w-full items-center gap-2 px-3 py-1 transition duration-150 ease-out hover:bg-slate-900/65">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold text-slate-200">{message.title}</span>
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="whitespace-nowrap text-[11px] text-slate-600">{messageMeta(message)}</span>
          <CopyTextButton value={message.copyText} />
        </div>
      </div>

      {!expanded ? (
        <div className="px-3 pb-1.5">
          <div className="truncate text-[12px] leading-5 text-slate-500">{preview}</div>
        </div>
      ) : null}

      {expanded ? (
        <div className="min-w-0 border-t border-slate-800/60 p-3">
          {message.text ? (
            <div className={cn(
              "text-[13px] leading-5 text-slate-300",
              wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
          )}>{message.text}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

const ProcessOutputBlock = memo(function ProcessOutputBlock({
  entry,
  wrapContent
}: {
  entry: TranscriptProcessEntry
  wrapContent: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const messages = useMemo(() => entry.items.map(messageFromItem), [entry.items])
  const itemCountLabel = `${entry.items.length} ${entry.items.length === 1 ? "event" : "events"}`
  const metaLabel = `${itemCountLabel} / ${formatTime(entry.createdAt)}`
  const preview = useMemo(() => processPreview(entry), [entry])
  const copyText = useMemo(() => entry.items.map((item) => item.text).filter(Boolean).join("\n\n"), [entry.items])

  return (
    <article className="group min-w-0 border-b border-slate-800/45 pb-5">
      <div className="flex w-full items-center gap-2 rounded-md border border-slate-800/80 bg-slate-900/35 px-3 py-1.5 transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/55">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-100">Thoughts</span>
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-slate-500 transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="whitespace-nowrap text-[11px] text-slate-500">{metaLabel}</span>
          <CopyTextButton value={copyText || preview} />
        </div>
      </div>

      {!expanded ? (
        <div className="mt-2 truncate px-1 text-[12px] leading-5 text-slate-500">{preview}</div>
      ) : (
        <div className="relative mt-3 grid min-w-0 gap-2 pl-6 pr-2 before:absolute before:bottom-5 before:left-2.5 before:top-0 before:w-px before:bg-slate-800/80">
          {messages.map((message) => (
            <div key={message.id} className="relative min-w-0 before:absolute before:left-[-14px] before:top-5 before:h-px before:w-3 before:bg-slate-800/80">
              <ProcessItemBlock
                message={message}
                wrapContent={wrapContent}
              />
            </div>
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
  const composerRef = useRef<ComposerHandle | null>(null)
  const entries = useMemo(() => transcriptEntriesFromDetail(detail), [detail])
  const title = selectedThread?.title ?? session?.title ?? "New Codex session"
  const subtitle = selectedThread?.cwd ?? session?.cwd ?? project?.path ?? "Select a project to begin"
  const tokens = detail?.tokensUsed ?? session?.tokensUsed ?? 0
  const status = selectedThread?.status ?? session?.status ?? "idle"

  useImperativeHandle(ref, () => ({
    focusPrompt: () => composerRef.current?.focusPrompt() ?? false
  }), [])

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
          animate={{ width: "100%" }}
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
                        wrapContent={wrapSessionContent}
                      />
                    ) : (
                      <MessageBlock
                        message={messageFromItem(entry.item)}
                        wrapContent={wrapSessionContent}
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

      </div>
    </section>
  )
}))
