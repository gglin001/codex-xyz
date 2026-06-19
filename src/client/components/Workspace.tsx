import {
  Bot,
  Check,
  Code2,
  Copy,
  FileUp,
  Maximize2,
  Menu,
  PanelRight,
  Play,
  Plus,
  Send,
  Square,
  Terminal,
  UserRound,
  X
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import type { FormEvent, KeyboardEvent } from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ControlThread, ThreadDetail, ThreadItem } from "../../server/domain.js"
import { cn } from "../classNames.js"
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
  onPromptChange: (value: string) => void
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPromptSubmit: (event: FormEvent) => void
  onModeChange: (mode: ComposerMode) => void
  onWorkdirChange: (value: string) => void
  onGoalModeChange: (value: boolean) => void
  onInterrupt: () => void
  onResume: () => void
  onOpenMobileMenu: () => void
  onOpenMobileInspector: () => void
}

type MessageRole = "system" | "user" | "assistant" | "tool"

type CodeBlock = {
  id: string
  language: string
  code: string
  title: string
}

type ChatMessage = {
  id: string
  role: MessageRole
  title: string
  text: string
  time: string
  codeBlocks: CodeBlock[]
}

const spring = { type: "spring", stiffness: 340, damping: 34 } as const

const sampleCode = `export async function runCodexSession(project) {
  const session = await createSession({
    cwd: project.path,
    prompt: "Inspect the current diff and propose the next step"
  })

  return streamSessionEvents(session.id)
}`

function fallbackMessages(session: WorkbenchSession | null): ChatMessage[] {
  return [
    {
      id: "system-preview",
      role: "system",
      title: "System",
      text: "Codex session manager is ready. Select a project, open a session, or create a new playground.",
      time: new Date().toISOString(),
      codeBlocks: []
    },
    {
      id: "user-preview",
      role: "user",
      title: "You",
      text: session?.preview ?? "Refactor the workspace into a three-pane coding session manager.",
      time: session?.updatedAt ?? new Date().toISOString(),
      codeBlocks: []
    },
    {
      id: "assistant-preview",
      role: "assistant",
      title: "Codex",
      text: "I will keep the control plane data flow intact and replace the visual layer with a fluid workbench shell. The code block below can be expanded into Canvas mode.",
      time: session?.updatedAt ?? new Date().toISOString(),
      codeBlocks: [
        {
          id: "sample-code",
          language: "ts",
          title: "session-runner.ts",
          code: sampleCode
        }
      ]
    }
  ]
}

function messageRoleForItem(item: ThreadItem): MessageRole {
  if (item.type === "user") {
    return "user"
  }
  if (item.type === "agent" || item.type === "plan") {
    return "assistant"
  }
  if (item.type === "command" || item.type === "file") {
    return "tool"
  }
  return "system"
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

function messagesFromDetail(detail: ThreadDetail | null, session: WorkbenchSession | null) {
  if (!detail || detail.items.length === 0) {
    return fallbackMessages(session)
  }

  return detail.items.map((item) => {
    const role = messageRoleForItem(item)
    const codeBlocks = extractCodeBlocks(item)
    const stripped = stripCodeFences(item.text)
    return {
      id: item.id,
      role,
      title: itemTitle(item),
      text: stripped || item.text || "Pending...",
      time: item.createdAt,
      codeBlocks
    } satisfies ChatMessage
  })
}

function roleIcon(role: MessageRole) {
  if (role === "user") {
    return <UserRound size={15} />
  }
  if (role === "assistant") {
    return <Bot size={15} />
  }
  if (role === "tool") {
    return <Terminal size={15} />
  }
  return <Code2 size={15} />
}

function roleTone(role: MessageRole) {
  if (role === "user") {
    return "border-slate-700 bg-slate-800 text-slate-100"
  }
  if (role === "assistant") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
  }
  if (role === "tool") {
    return "border-violet-400/30 bg-violet-400/10 text-violet-100"
  }
  return "border-slate-800 bg-slate-900 text-slate-300"
}

function codePreview(value: string) {
  const lines = value.split(/\r?\n/)
  return lines.slice(0, 12).join("\n")
}

const CodeBlockView = memo(function CodeBlockView({
  block,
  active,
  onOpenCanvas
}: {
  block: CodeBlock
  active: boolean
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
            className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition duration-150 ease-out hover:bg-slate-800 hover:text-slate-100"
            title="Run"
            aria-label="Run"
          >
            <Play size={14} />
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
      <pre className="max-h-[320px] overflow-auto p-3 font-mono text-[12px] leading-5 text-slate-300">
        <code>{codePreview(block.code)}</code>
      </pre>
    </div>
  )
})

const MessageBlock = memo(function MessageBlock({
  message,
  activeBlockId,
  onOpenCanvas
}: {
  message: ChatMessage
  activeBlockId: string | null
  onOpenCanvas: (block: CodeBlock) => void
}) {
  return (
    <article className="group grid grid-cols-[32px_minmax(0,1fr)] gap-3">
      <div className={cn("mt-1 flex h-8 w-8 items-center justify-center rounded-md border", roleTone(message.role))}>
        {roleIcon(message.role)}
      </div>
      <div className="min-w-0 border-b border-slate-800/45 pb-5">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[13px] font-semibold text-slate-100">{message.title}</h3>
          <time className="shrink-0 text-[11px] text-slate-600">{formatTime(message.time)}</time>
        </div>
        {message.text ? (
          <div className="whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-300">{message.text}</div>
        ) : null}
        {message.codeBlocks.length > 0 ? (
          <div className="mt-3 grid gap-3">
            {message.codeBlocks.map((block) => (
              <CodeBlockView
                key={block.id}
                block={block}
                active={activeBlockId === block.id}
                onOpenCanvas={onOpenCanvas}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
          <p className="truncate text-[11px] text-slate-500">Canvas editor / {block.language}</p>
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
          <span>Live preview</span>
          <span>{block.code.split(/\r?\n/).length} lines</span>
        </div>
        <pre className="min-h-full rounded-md border border-slate-800/80 bg-[#050608] p-4 font-mono text-[12px] leading-6 text-slate-300 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <code>{block.code}</code>
        </pre>
      </div>
    </motion.aside>
  )
})

const Composer = memo(function Composer({
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
}: Pick<
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
>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canInterrupt = selectedThread?.status === "running" && !busy
  const canResume = Boolean(selectedThreadId) && selectedThread?.status !== "running" && !busy
  const submitTitle = goalMode ? "Start goal mode" : promptTarget === "thread" ? "Send prompt" : "Create session"
  const placeholder = goalMode
    ? "Describe the goal objective"
    : promptTarget === "thread"
      ? "Ask Codex to continue this session"
      : "Start a new Codex session"

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.style.height = "0px"
    textarea.style.height = `${Math.min(220, Math.max(52, textarea.scrollHeight))}px`
  }, [prompt])

  return (
    <div className="shrink-0 border-t border-slate-800/80 bg-slate-950/75 px-4 py-3 backdrop-blur-md">
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
                onClick={() => onModeChange(promptTarget === "new" && selectedThreadId ? "thread" : "new")}
              >
                <Plus size={15} />
              </button>
              <button
                type="button"
                className="inline-flex h-8 min-w-8 items-center justify-center rounded-md text-slate-500 transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100"
                title="Attach context"
                aria-label="Attach context"
              >
                <FileUp size={15} />
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
})

export const Workspace = memo(function Workspace({
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
  onOpenMobileMenu,
  onOpenMobileInspector
}: WorkspaceProps) {
  const [canvasBlock, setCanvasBlock] = useState<CodeBlock | null>(null)
  const messages = useMemo(() => messagesFromDetail(detail, session), [detail, session])
  const title = selectedThread?.title ?? session?.title ?? "New Codex session"
  const subtitle = selectedThread?.cwd ?? session?.cwd ?? project?.path ?? "Select a project to begin"
  const tokens = detail?.tokensUsed ?? session?.tokensUsed ?? 0
  const status = selectedThread?.status ?? session?.status ?? "idle"

  useEffect(() => {
    setCanvasBlock(null)
  }, [selectedThreadId, session?.id])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-slate-950 text-slate-200">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/75 px-3 backdrop-blur-md md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800/80 bg-slate-900/50 text-slate-400 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100 md:hidden"
            title="Open navigator"
            aria-label="Open navigator"
            onClick={onOpenMobileMenu}
          >
            <Menu size={17} />
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800/80 bg-slate-900/50 text-slate-400 transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100 md:hidden"
            title="Open inspector"
            aria-label="Open inspector"
            onClick={onOpenMobileInspector}
          >
            <PanelRight size={17} />
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
            <div className="mx-auto grid w-full max-w-[860px] gap-5">
              <div className="grid gap-2 border-b border-slate-800/50 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-slate-600">
                  <span>{project?.name ?? "Workspace"}</span>
                  <span>/</span>
                  <span>{detail ? formatDateTime(detail.updatedAt) : "Preview stream"}</span>
                </div>
                <p className="max-w-2xl text-[13px] leading-5 text-slate-500">
                  Distraction-free Codex stream with runnable code blocks, project-aware context, and a split Canvas for deeper inspection.
                </p>
              </div>

              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={spring}
                  >
                    <MessageBlock
                      message={message}
                      activeBlockId={canvasBlock?.id ?? null}
                      onOpenCanvas={setCanvasBlock}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <Composer
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
        </motion.div>

        <AnimatePresence>
          {canvasBlock ? <CanvasPane key={canvasBlock.id} block={canvasBlock} onClose={() => setCanvasBlock(null)} /> : null}
        </AnimatePresence>
      </div>
    </section>
  )
})
