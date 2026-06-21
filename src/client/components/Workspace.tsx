import {
  Ellipsis,
  Bot,
  Goal,
  Check,
  Code2,
  Copy,
  Menu,
  Play,
  Plus,
  Send,
  Settings,
  Square
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, SubmitEvent } from "react"
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { ControlThread, SessionDisplayStatus, ThreadDetail, ThreadItem } from "../../server/domain.js"
import { sessionDisplayStatus } from "../../server/domain.js"
import { copyToClipboard } from "../clipboard.js"
import { cn, tone, ui } from "../designSystem.js"
import { getFirstLineTextPreview } from "../textPreview.js"
import { getTranscriptEntries, type TranscriptProcessEntry } from "../transcriptEntries.js"
import { formatTime, formatTokens, itemTitle, statusLabel } from "../uiFormat.js"
import { useSwipeGesture } from "../useSwipeGesture.js"
import {
  CollapsibleCard,
  ComposerIconButton,
  CopyIconButton,
  FieldShell,
  LargeIconButton
} from "./uiPrimitives.js"
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
  displayScale: number
  navigatorVisible: boolean
  inspectorVisible: boolean
  onPromptChange: (value: string) => void
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPromptSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  onModeChange: (mode: ComposerMode) => void
  onWorkdirChange: (value: string) => void
  onGoalModeChange: (value: boolean) => void
  onInterrupt: () => void
  onResume: () => void
  onToggleNavigator: () => void
  onToggleInspector: () => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
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
  const lastText = entry.items.findLast((item) => item.text.trim())?.text ?? ""
  return getFirstLineTextPreview(lastText.trim() || "No output yet")
}

function messageMeta(message: ChatMessage) {
  return formatTime(message.time)
}

function messageCardTitle(message: ChatMessage) {
  if (message.title === "User" || message.title === "Steer") {
    return "Prompt"
  }
  if (message.title === "Codex") {
    return "Response"
  }
  return message.title
}

function messageSurfaceClass(message: ChatMessage) {
  const title = messageCardTitle(message)
  if (title === "Prompt") {
    return "border-accent-soft bg-selected/35"
  }
  if (title === "Response") {
    return "border-border bg-detail/70"
  }
  return "border-border bg-app-bg/60"
}

function headerMeta(value: string) {
  return (
    <span className="max-w-[34vw] truncate whitespace-nowrap text-[11px] text-muted sm:max-w-none">
      {value}
    </span>
  )
}

function statusDotClass(status: SessionDisplayStatus) {
  if (status === "active") {
    return tone.running.dot
  }
  if (status === "not_loaded") {
    return tone.stale.dot
  }
  if (status === "system_error" || status === "turn_failed" || status === "turn_interrupted") {
    return tone.error.dot
  }
  if (status === "turn_completed") {
    return tone.completed.dot
  }
  return tone.neutral.dot
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

  const copyValue = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setCopied(true)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => setCopied(false), 1200)
    void copyToClipboard(value)
  }, [value])

  return (
    <CopyIconButton label={label} onClick={copyValue}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </CopyIconButton>
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
    <CollapsibleCard
      title={messageCardTitle(message)}
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      meta={headerMeta(messageMeta(message))}
      actions={<CopyTextButton value={message.copyText} />}
      preview={<div className="truncate text-[12px] leading-5 text-muted">{preview}</div>}
      className={messageSurfaceClass(message)}
    >
      {message.text ? (
        <div className={cn(
          "text-[length:var(--transcript-font-size)] leading-[var(--transcript-line-height)] text-fg-strong",
          wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
        )}>{message.text}</div>
      ) : null}
    </CollapsibleCard>
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
    <CollapsibleCard
      title={message.title}
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      meta={headerMeta(messageMeta(message))}
      actions={<CopyTextButton value={message.copyText} />}
      preview={<div className="truncate text-[11px] leading-5 text-muted">{preview}</div>}
      size="compact"
      className="bg-app-bg/55 shadow-none"
    >
      {message.text ? (
        <div className={cn(
          "text-[length:var(--process-font-size)] leading-[var(--process-line-height)] text-fg",
          wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
        )}>{message.text}</div>
      ) : null}
    </CollapsibleCard>
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
    <CollapsibleCard
      title="Thoughts"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      meta={headerMeta(metaLabel)}
      actions={<CopyTextButton value={copyText || preview} />}
      size="prominent"
      preview={<div className="truncate text-[12px] leading-5 text-muted">{preview}</div>}
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
    <div className="rounded-[12px] border border-dashed border-border bg-detail/45 px-5 py-8 text-center">
      <div className={cn("mx-auto mb-4 h-10 w-10 border border-border text-muted-strong", ui.iconBox)}>
        <Bot size={22} />
      </div>
      <h2 className="text-[15px] font-semibold text-fg-strong">
        {hasThread ? "Waiting for Codex transcript" : "No Codex session selected"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-muted">
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
> & {
  onPromptFocus?: () => void
}

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
  onResume,
  onPromptFocus
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canInterrupt = selectedThread?.status === "active" && !busy
  const canResume = Boolean(selectedThreadId) && selectedThread?.status !== "active" && !busy
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
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
    textarea.style.height = `${Math.min(160, Math.max(30, textarea.scrollHeight))}px`
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
        <div className="mb-3 grid gap-2 text-[12px]">
          {busyAction ? <div className={cn(ui.alert, tone.neutral.alert)}>{busyAction}...</div> : null}
          {notice ? <div className={cn(ui.alert, tone.running.alert)}>{notice}</div> : null}
          {error ? <div className={cn(ui.alert, tone.error.alert)}>{error}</div> : null}
        </div>
      ) : null}

      {promptTarget === "new" ? (
        <FieldShell className="mb-3 h-9 px-3" icon={<Code2 size={14} />}>
          <input
            className={cn(ui.input, "font-mono text-[12px] text-fg")}
            value={workdir}
            onChange={(event) => onWorkdirChange(event.target.value)}
            placeholder="/path/to/repo"
            disabled={busy}
            aria-label="Working directory"
          />
        </FieldShell>
      ) : null}

      <form onSubmit={onPromptSubmit}>
        <div className={ui.composerShell}>
          <textarea
            ref={textareaRef}
            className={cn(ui.textarea, "max-h-[160px] min-h-[34px] px-0.5 py-0.5 text-[length:var(--composer-font-size)] leading-[var(--composer-line-height)]")}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onPromptKeyDown}
            onFocus={onPromptFocus}
            placeholder={placeholder}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <ComposerIconButton
                title="New session"
                aria-label="New session"
                pressed={promptTarget === "new"}
                disabled={busy}
                onClick={() => {
                  onModeChange(promptTarget === "new" && selectedThreadId ? "thread" : "new")
                  focusPromptOnNextFrame()
                }}
              >
                <Plus size={14} />
              </ComposerIconButton>
              <ComposerIconButton
                title="Goal mode"
                aria-label="Goal mode"
                pressed={goalMode}
                disabled={!canUseGoalMode || busy}
                onClick={() => onGoalModeChange(!goalMode)}
              >
                <Goal size={14} />
              </ComposerIconButton>
              <span className="hidden md:contents">
                <ComposerIconButton
                  title="Interrupt"
                  aria-label="Interrupt"
                  disabled={!canInterrupt}
                  onClick={onInterrupt}
                >
                  <Square size={14} />
                </ComposerIconButton>
                <ComposerIconButton
                  title="Resume"
                  aria-label="Resume"
                  disabled={!canResume}
                  onClick={onResume}
                >
                  <Play size={14} />
                </ComposerIconButton>
              </span>
              <div className="relative z-10 md:hidden">
                <ComposerIconButton
                  title="More actions"
                  aria-label="More actions"
                  pressed={moreActionsOpen}
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
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={spring}
                      >
                        <div className="p-1">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={!canInterrupt}
                            onClick={() => {
                              onInterrupt()
                              setMoreActionsOpen(false)
                            }}
                          >
                            <Square size={15} className="shrink-0 text-muted" />
                            <span>Interrupt</span>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={!canResume}
                            onClick={() => {
                              onResume()
                              setMoreActionsOpen(false)
                            }}
                          >
                            <Play size={15} className="shrink-0 text-muted" />
                            <span>Resume</span>
                          </button>
                        </div>
                      </motion.div>
                    </>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
            <button
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
  onToggleNavigator,
  onToggleInspector,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown
}, ref) {
  const composerRef = useRef<ComposerHandle | null>(null)
  const composerShellRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(() => transcriptEntriesFromDetail(detail), [detail])
  const title = selectedThread?.title ?? session?.title ?? "New Codex session"
  const subtitle = selectedThread?.cwd ?? session?.cwd ?? project?.path ?? "Select a project to begin"
  const tokens = detail?.tokensUsed ?? session?.tokensUsed ?? 0
  const status = selectedThread ? sessionDisplayStatus(selectedThread) : (session?.status ?? "idle")
  const contentScaleStyle = useMemo(() => ({
    "--transcript-font-size": `${14 * displayScale}px`,
    "--transcript-line-height": `${24 * displayScale}px`,
    "--process-font-size": `${13 * displayScale}px`,
    "--process-line-height": `${22 * displayScale}px`,
    "--composer-font-size": `${16 * displayScale}px`,
    "--composer-line-height": `${26 * displayScale}px`,
    "--transcript-gap": `${Math.max(9, 12 * displayScale)}px`
  }) as CSSProperties, [displayScale])

  useImperativeHandle(ref, () => ({
    focusPrompt: () => composerRef.current?.focusPrompt() ?? false
  }), [])

  useSwipeGesture(composerShellRef, {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown
  })

  useEffect(() => {
    const root = rootRef.current
    const composerShell = composerShellRef.current
    if (!root || !composerShell) {
      return
    }

    let frame: number | null = null
    const updateComposerHeight = () => {
      frame = null
      root.style.setProperty("--composer-height", `${Math.ceil(composerShell.getBoundingClientRect().height)}px`)
    }
    const scheduleUpdate = () => {
      if (frame !== null) {
        return
      }
      frame = window.requestAnimationFrame(updateComposerHeight)
    }

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(composerShell)
    scheduleUpdate()

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      observer.disconnect()
      root.style.removeProperty("--composer-height")
    }
  }, [])

  const settleMobilePromptFocus = useCallback(() => {
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 767px)").matches) {
      return
    }
    const scrollElement = transcriptScrollRef.current
    if (!scrollElement) {
      return
    }

    const scrollToEnd = () => {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: "auto"
      })
    }

    window.requestAnimationFrame(scrollToEnd)
    window.setTimeout(scrollToEnd, 180)
    window.setTimeout(scrollToEnd, 360)
  }, [])

  return (
    <section
      ref={rootRef}
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-app-bg text-fg", sessionContentWidthClass)}
      style={contentScaleStyle}
    >
      <header className="hidden md:flex md:relative z-[110] md:h-14 shrink-0 items-center justify-between gap-3 border-b border-border md:bg-app-bg/95 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <LargeIconButton
            title={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-label={navigatorVisible ? "Hide sessions" : "Open sessions"}
            pressed={navigatorVisible}
            onClick={onToggleNavigator}
          >
            <Menu size={15} />
          </LargeIconButton>
          <div className="grid min-w-0 gap-0.5">
            <h1 className="truncate text-[15px] font-semibold leading-5 text-fg-strong">{title}</h1>
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
              <span className="truncate">{subtitle}</span>
              <span className="hidden h-3 border-l border-border sm:inline" />
              <span className="hidden shrink-0 sm:inline">{formatTokens(tokens)} tokens</span>
              <span className="hidden h-3 border-l border-border sm:inline" />
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(status))} />
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
          <div ref={transcriptScrollRef} className="mobile-transcript-scroll min-h-0 flex-1 overflow-y-auto scroll-mask-y-t px-4 pt-[calc(var(--safe-inset-top)+1rem)] md:px-8 md:pb-5 md:pt-5">
            <SessionContentFrame className="grid gap-[var(--transcript-gap)]">
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

          <div ref={composerShellRef} className="mobile-composer-bar relative z-[70] shrink-0 border-t border-border bg-app-bg/95 px-4 pt-2 md:z-auto md:px-8 md:pb-3">
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
                onPromptFocus={settleMobilePromptFocus}
              />
            </SessionContentFrame>
          </div>
        </motion.div>

      </div>
    </section>
  )
}))
