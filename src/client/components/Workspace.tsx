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
import type { FormEvent, KeyboardEvent, MouseEvent, ReactNode } from "react"
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { ControlThread, RuntimeStatus, ThreadDetail, ThreadItem } from "../../server/domain.js"
import { copyToClipboard } from "../clipboard.js"
import { cn, tone, ui } from "../designSystem.js"
import { getFirstLineTextPreview } from "../textPreview.js"
import { getTranscriptEntries, type TranscriptProcessEntry } from "../transcriptEntries.js"
import { formatTime, formatTokens, itemTitle, statusLabel } from "../uiFormat.js"
import { useSwipeGesture } from "../useSwipeGesture.js"
import {
  CollapsibleCard,
  ComposerIconButton,
  ControlCard,
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
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
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

function headerMeta(value: string) {
  return (
    <span className="max-w-[34vw] truncate whitespace-nowrap text-[10px] text-muted sm:max-w-none">
      {value}
    </span>
  )
}

function statusDotClass(status: RuntimeStatus) {
  if (status === "running") {
    return tone.running.dot
  }
  if (status === "stale") {
    return tone.stale.dot
  }
  if (status === "failed" || status === "interrupted") {
    return tone.error.dot
  }
  if (status === "completed") {
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
    >
      {message.text ? (
        <div className={cn(
          "text-[15px] leading-7 text-fg",
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
      className="rounded-[14px] shadow-none"
    >
      {message.text ? (
        <div className={cn(
          "text-[13px] leading-6 text-fg",
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
    <ControlCard className="border-dashed px-5 py-8 text-center">
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
    </ControlCard>
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
  | "onToggleNavigator"
  | "onToggleInspector"
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
  onResume,
  onToggleNavigator,
  onToggleInspector,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canInterrupt = selectedThread?.status === "running" && !busy
  const canResume = Boolean(selectedThreadId) && selectedThread?.status !== "running" && !busy
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
        <FieldShell className="mb-3 h-10 px-3.5" icon={<Code2 size={14} />}>
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
            className={cn(ui.textarea, "max-h-[160px] min-h-[30px] px-1 py-1 text-[17px] leading-7")}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder={placeholder}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
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
              <div className="relative md:hidden">
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
                        className="fixed inset-0 z-[115]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setMoreActionsOpen(false)}
                      />
                      <motion.div
                        className="absolute bottom-full left-0 z-[116] mb-2 w-44 rounded-[20px] border border-border bg-detail shadow-popover"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={spring}
                      >
                        <div className="p-1">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
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
                            className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control disabled:cursor-not-allowed disabled:opacity-30"
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
                        <div className="mx-3 border-t border-border" />
                        <div className="p-1">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control"
                            onClick={() => {
                              onToggleNavigator()
                              setMoreActionsOpen(false)
                            }}
                          >
                            <Menu size={15} className="shrink-0 text-muted" />
                            <span>Sessions</span>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left text-[13px] text-fg transition duration-150 ease-out hover:bg-control"
                            onClick={() => {
                              onToggleInspector()
                              setMoreActionsOpen(false)
                            }}
                          >
                            <Settings size={15} className="shrink-0 text-muted" />
                            <span>Settings</span>
                          </button>
                        </div>
                      </motion.div>
                    </>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
            <button
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-accent-soft bg-accent/10 text-accent transition duration-150 ease-out hover:bg-accent/18 disabled:cursor-not-allowed disabled:opacity-30"
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
  onSwipeRight
}, ref) {
  const composerRef = useRef<ComposerHandle | null>(null)
  const composerShellRef = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(() => transcriptEntriesFromDetail(detail), [detail])
  const title = selectedThread?.title ?? session?.title ?? "New Codex session"
  const subtitle = selectedThread?.cwd ?? session?.cwd ?? project?.path ?? "Select a project to begin"
  const tokens = detail?.tokensUsed ?? session?.tokensUsed ?? 0
  const status = selectedThread?.status ?? session?.status ?? "idle"

  useImperativeHandle(ref, () => ({
    focusPrompt: () => composerRef.current?.focusPrompt() ?? false
  }), [])

  useSwipeGesture(composerShellRef, {
    onSwipeLeft,
    onSwipeRight
  })

  return (
    <section className={cn("flex h-full min-h-0 min-w-0 flex-col bg-app-bg text-fg", sessionContentWidthClass)}>
      <header className="hidden md:flex md:relative z-[110] md:h-16 shrink-0 items-center justify-between gap-3 md:bg-app-bg md:px-5">
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
            <h1 className="truncate text-[17px] font-semibold leading-6 text-fg-strong">{title}</h1>
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted">
              <span className="truncate">{subtitle}</span>
              <span className="hidden shrink-0 sm:inline">/</span>
              <span className="hidden shrink-0 sm:inline">{formatTokens(tokens)} tokens</span>
              <span className="hidden shrink-0 sm:inline">/</span>
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
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-[calc(var(--safe-inset-top)+1rem)] md:px-8 md:pt-4">
            <SessionContentFrame className="grid gap-3 md:gap-4">
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

          <div ref={composerShellRef} className="shrink-0 bg-app-bg px-4 pb-2.5 pt-2 md:bg-app-bg/95 md:px-8">
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
                onToggleNavigator={onToggleNavigator}
                onToggleInspector={onToggleInspector}
              />
            </SessionContentFrame>
          </div>
        </motion.div>

      </div>
    </section>
  )
}))
