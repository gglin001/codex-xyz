import {
  Bot,
  Check,
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
import { cn, tone, ui } from "../designSystem.js"
import { getFirstLineTextPreview } from "../textPreview.js"
import { getTranscriptEntries, type TranscriptProcessEntry } from "../transcriptEntries.js"
import { formatDateTime, formatTime, formatTokens, itemTitle, statusLabel } from "../uiFormat.js"
import {
  CollapsibleCard,
  ComposerIconButton,
  ControlCard,
  CopyIconButton,
  DisclosureRow,
  FieldShell,
  LargeIconButton,
  MessageGroup
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
  const firstText = entry.items.find((item) => item.text.trim())?.text ?? ""
  return getFirstLineTextPreview(firstText.trim() || "No output yet")
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
    <CopyIconButton label={label} onClick={copyValue}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
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
    <MessageGroup role={message.title} time={messageMeta(message)}>
      <CollapsibleCard
        title={messageCardTitle(message)}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        actions={<CopyTextButton value={message.copyText} />}
        preview={<div className="truncate text-[13px] leading-6 text-muted">{preview}</div>}
      >
        {message.text ? (
          <div className={cn(
            "text-[16px] leading-8 text-fg",
            wrapContent ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
          )}>{message.text}</div>
        ) : null}
      </CollapsibleCard>
    </MessageGroup>
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
      meta={<span className="whitespace-nowrap text-[10px] text-muted">{messageMeta(message)}</span>}
      actions={<CopyTextButton value={message.copyText} />}
      preview={<div className="truncate text-[12px] leading-5 text-muted">{preview}</div>}
      size="compact"
      className="rounded-[14px] shadow-none"
    >
      {message.text ? (
        <div className={cn(
          "text-[14px] leading-6 text-fg",
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
    <MessageGroup role="Model" time={formatTime(entry.createdAt)}>
      <CollapsibleCard
        title="Thoughts"
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        meta={<span className="hidden whitespace-nowrap text-[11px] text-muted sm:inline">{metaLabel}</span>}
        actions={<CopyTextButton value={copyText || preview} />}
        size="prominent"
        preview={<DisclosureRow onClick={() => setExpanded(true)} divided={false} className="-mx-4 -my-3">Expand to view model thoughts</DisclosureRow>}
        previewClassName="p-0"
        bodyClassName="grid gap-2 px-4 pb-4 pt-0"
      >
        {messages.map((message) => (
          <ProcessItemBlock
            key={message.id}
            message={message}
            wrapContent={wrapContent}
          />
        ))}
        <DisclosureRow expanded onClick={() => setExpanded(false)} divided={false} className="-mx-4 -mb-4 mt-2">
          Collapse to hide model thoughts
        </DisclosureRow>
      </CollapsibleCard>
    </MessageGroup>
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
    <ControlCard className="border-dashed px-5 py-12 text-center">
      <div className={cn("mx-auto mb-4 h-12 w-12 border border-border text-muted-strong", ui.iconBox)}>
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
          {busyAction ? <div className={cn(ui.alert, tone.neutral.alert)}>{busyAction}...</div> : null}
          {notice ? <div className={cn(ui.alert, tone.running.alert)}>{notice}</div> : null}
          {error ? <div className={cn(ui.alert, tone.error.alert)}>{error}</div> : null}
        </div>
      ) : null}

      {promptTarget === "new" ? (
        <FieldShell className="mb-3 h-11 px-4" icon={<Code2 size={15} />}>
          <input
            className={cn(ui.input, "font-mono text-[13px] text-fg")}
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
            className={cn(ui.textarea, "max-h-[180px] min-h-8 px-1 py-1 text-[20px] leading-8")}
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
                <Plus size={15} />
              </ComposerIconButton>
              <ComposerIconButton
                title="Goal mode"
                aria-label="Goal mode"
                pressed={goalMode}
                disabled={!canUseGoalMode || busy}
                onClick={() => onGoalModeChange(!goalMode)}
              >
                <Code2 size={15} />
              </ComposerIconButton>
              <ComposerIconButton
                title="Interrupt"
                aria-label="Interrupt"
                disabled={!canInterrupt}
                onClick={onInterrupt}
              >
                <Square size={15} />
              </ComposerIconButton>
              <ComposerIconButton
                title="Resume"
                aria-label="Resume"
                disabled={!canResume}
                onClick={onResume}
              >
                <Play size={15} />
              </ComposerIconButton>
            </div>
            <button
              className={ui.submitButton}
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
          <LargeIconButton
            title={navigatorVisible ? "Hide sessions" : "Open sessions"}
            aria-label={navigatorVisible ? "Hide sessions" : "Open sessions"}
            pressed={navigatorVisible}
            onClick={onToggleNavigator}
          >
            {navigatorVisible ? <PanelLeftClose size={17} /> : <Menu size={17} />}
          </LargeIconButton>
          <div className="flex min-w-0 items-baseline gap-5">
            <div className="min-w-0">
              <h1 className="truncate text-[20px] font-semibold text-fg-strong">{title}</h1>
              <p className="truncate text-[13px] text-muted">{subtitle}</p>
            </div>
            <span className="hidden shrink-0 text-[13px] font-medium text-muted lg:inline">
              {formatTokens(tokens)} tokens
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden h-10 items-center gap-2 rounded-full border border-border bg-detail px-3 text-[12px] text-muted sm:flex">
            <span className="h-2 w-2 rounded-full bg-running-dot" />
            <span>{statusLabel(status)}</span>
          </div>
          <LargeIconButton
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            pressed={inspectorVisible}
            onClick={onToggleInspector}
          >
            <SlidersHorizontal size={17} />
          </LargeIconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <motion.div
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          animate={{ width: "100%" }}
          transition={spring}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8">
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

          <div className="shrink-0 bg-app-bg/95 px-4 pb-4 pt-3 md:px-8">
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
