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
const sessionContentWidthClass = "[--session-content-width:900px]"
const sessionContentFrameClass = "mx-auto w-full min-w-0 max-w-[var(--session-content-width)]"
const roundIconButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-border bg-control text-muted-strong shadow-control transition duration-150 ease-out hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
const composerIconButtonClass =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-[16px] border border-transparent bg-control text-fg transition duration-150 ease-out hover:bg-control-hover hover:text-fg-strong disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.98]"

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
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted transition duration-150 ease-out hover:bg-control hover:text-fg-strong"
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
    <article className="group min-w-0 overflow-hidden rounded-[18px] border border-border bg-detail shadow-control transition duration-150 ease-out hover:border-border-strong">
      <div className="flex min-h-11 w-full items-center gap-2 border-b border-border bg-detail transition duration-150 ease-out hover:bg-surface">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 px-4 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-fg">{message.title}</span>
          </span>
          <ChevronDown
            size={17}
            className={cn("shrink-0 text-muted transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <span className="whitespace-nowrap text-[12px] text-muted">{messageMeta(message)}</span>
          <CopyTextButton value={message.copyText} />
        </div>
      </div>
      {!expanded ? (
        <div className="px-4 py-3">
          <div className="truncate text-[13px] leading-6 text-muted">{preview}</div>
        </div>
      ) : null}

      {expanded ? (
        <div className="min-w-0 px-4 py-4">
          {message.text ? (
            <div className={cn(
              "text-[16px] leading-8 text-fg",
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
    <div className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-detail">
      <div className="flex min-h-9 w-full items-center gap-2 transition duration-150 ease-out hover:bg-surface">
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-fg">{message.title}</span>
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-muted transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1 pr-1.5">
          <span className="whitespace-nowrap text-[10px] text-muted">{messageMeta(message)}</span>
          <CopyTextButton value={message.copyText} />
        </div>
      </div>

      {!expanded ? (
        <div className="px-3 pb-2">
          <div className="truncate text-[12px] leading-5 text-muted">{preview}</div>
        </div>
      ) : null}

      {expanded ? (
        <div className="min-w-0 border-t border-border p-3">
          {message.text ? (
            <div className={cn(
              "text-[14px] leading-6 text-fg",
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
    <article className="group min-w-0">
      <div className="overflow-hidden rounded-[18px] border border-border bg-detail shadow-panel transition duration-150 ease-out hover:border-border-strong">
        <div className="flex min-h-12 w-full items-center gap-2 transition duration-150 ease-out hover:bg-surface">
        <button
          type="button"
          className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 px-4 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block truncate text-[16px] font-semibold text-fg-strong">Thoughts</span>
          </span>
          <ChevronDown
            size={17}
            className={cn("shrink-0 text-muted-strong transition-transform duration-150 ease-out", expanded ? "rotate-180" : null)}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          <span className="hidden whitespace-nowrap text-[11px] text-muted sm:inline">{metaLabel}</span>
          <CopyTextButton value={copyText || preview} />
        </div>
      </div>

      {!expanded ? (
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-left text-[14px] text-fg transition duration-150 ease-out hover:bg-surface"
            onClick={() => setExpanded(true)}
          >
            <span className="min-w-0 truncate">Expand to view model thoughts</span>
            <ChevronDown size={16} className="shrink-0 text-muted-strong" />
          </button>
      ) : (
          <>
            <div className="grid min-w-0 gap-2 px-4 pb-4">
              {messages.map((message) => (
                <ProcessItemBlock
                  key={message.id}
                  message={message}
                  wrapContent={wrapContent}
                />
              ))}
            </div>
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-left text-[14px] text-fg transition duration-150 ease-out hover:bg-surface"
              onClick={() => setExpanded(false)}
            >
              <span className="min-w-0 truncate">Collapse to hide model thoughts</span>
              <ChevronDown size={16} className="shrink-0 rotate-180 text-muted-strong" />
            </button>
          </>
      )}
      </div>
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
    <div className="rounded-[24px] border border-dashed border-border bg-detail px-5 py-12 text-center shadow-control">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[18px] border border-border bg-control text-muted-strong">
        <Bot size={18} />
      </div>
      <h2 className="text-[16px] font-semibold text-fg-strong">
        {hasThread ? "Waiting for Codex transcript" : "No Codex session selected"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-muted">
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
      ? "Start typing a prompt"
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
    textarea.style.height = `${Math.min(180, Math.max(32, textarea.scrollHeight))}px`
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
        <div className="mb-3 grid gap-2 text-[13px]">
          {busyAction ? <div className="rounded-[18px] border border-border bg-detail px-4 py-3 text-fg">{busyAction}...</div> : null}
          {notice ? <div className="rounded-[18px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-emerald-100">{notice}</div> : null}
          {error ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-rose-100">{error}</div> : null}
        </div>
      ) : null}

      {promptTarget === "new" ? (
        <label className="mb-3 flex h-11 items-center gap-3 rounded-[18px] border border-border bg-field px-4 text-muted transition duration-150 ease-out focus-within:border-border-strong focus-within:text-fg">
          <Code2 size={15} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] text-fg placeholder:text-muted focus:outline-none"
            value={workdir}
            onChange={(event) => onWorkdirChange(event.target.value)}
            placeholder="/path/to/repo"
            disabled={busy}
            aria-label="Working directory"
          />
        </label>
      ) : null}

      <form onSubmit={onPromptSubmit}>
        <div className="grid min-h-[112px] gap-2 rounded-[24px] border border-border-strong bg-surface px-4 py-3 shadow-panel transition duration-150 ease-out focus-within:border-white/20 focus-within:ring-2 focus-within:ring-focus-ring">
          <textarea
            ref={textareaRef}
            className="block max-h-[180px] min-h-8 w-full resize-none border-0 bg-transparent px-1 py-1 text-[20px] leading-8 text-fg-strong placeholder:text-muted focus:outline-none disabled:opacity-60"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder={placeholder}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className={cn(
                  composerIconButtonClass,
                  promptTarget === "new" ? "border-white/15 bg-[#444444] text-fg-strong shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" : null
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
                  composerIconButtonClass,
                  goalMode ? "border-white/15 bg-[#444444] text-fg-strong shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" : null
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
                className={composerIconButtonClass}
                title="Interrupt"
                aria-label="Interrupt"
                disabled={!canInterrupt}
                onClick={onInterrupt}
              >
                <Square size={15} />
              </button>
              <button
                type="button"
                className={composerIconButtonClass}
                title="Resume"
                aria-label="Resume"
                disabled={!canResume}
                onClick={onResume}
              >
                <Play size={15} />
              </button>
            </div>
            <button
              className="inline-flex h-10 min-w-[86px] shrink-0 items-center justify-center gap-2 rounded-[18px] border border-border bg-[#303030] px-4 text-[15px] font-semibold text-fg transition duration-150 ease-out hover:bg-[#3a3a3a] hover:text-fg-strong disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-[#222222] disabled:text-[#4f4f4f]"
              disabled={!canSubmitPrompt}
              title={submitTitle}
              aria-label={submitTitle}
            >
              <span>Run</span>
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
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col bg-app-bg text-fg", sessionContentWidthClass)}>
      <header className="relative z-[110] flex h-[72px] shrink-0 items-center justify-between gap-4 bg-app-bg px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            className={cn(
              roundIconButtonClass,
              navigatorVisible ? "bg-control-hover text-fg-strong" : null
            )}
            title={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-label={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-pressed={navigatorVisible}
            onClick={onToggleNavigator}
          >
            {navigatorVisible ? <PanelLeftClose size={17} /> : <Menu size={17} />}
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold text-fg-strong">{title}</h1>
            <p className="truncate text-[14px] text-muted">{formatTokens(tokens)} tokens / {subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden h-10 items-center gap-2 rounded-full border border-border bg-detail px-3 text-[12px] text-muted sm:flex">
            <span className="h-2 w-2 rounded-full bg-running-dot" />
            <span>{statusLabel(status)}</span>
          </div>
          <button
            type="button"
            className={cn(
              roundIconButtonClass,
              inspectorVisible ? "bg-control-hover text-fg-strong" : null
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
            <SessionContentFrame className="grid gap-8">
              <div className="grid gap-2 pb-2">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
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

          <div className="shrink-0 bg-app-bg px-4 pb-4 pt-3 md:px-8">
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
