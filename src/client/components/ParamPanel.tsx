import {
  Activity,
  Bot,
  CircleDotDashed,
  Cpu,
  FolderGit2,
  GitFork,
  Hash,
  ListTree,
  Play,
  Server,
  SlidersHorizontal,
  TimerReset,
  WrapText
} from "lucide-react"
import { memo, type ReactNode } from "react"
import type { ControlThread, ThreadDetail } from "../../server/domain.js"
import { cn } from "../classNames.js"
import { formatTokens, shortId, statusLabel } from "../uiFormat.js"
import type { WorkbenchSession } from "./workbenchTypes.js"

export type ParamPanelProps = {
  className?: string
  session: WorkbenchSession | null
  detail: ThreadDetail | null
  selectedThread: ControlThread | null
  wrapSessionContent: boolean
  defaultCwd: string
  onWrapSessionContentChange: (value: boolean) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
}

const sectionClass = "border-b border-border px-5 py-6 last:border-b-0"

function runtimeStatusTone(status: string | null | undefined) {
  if (status === "running") {
    return "bg-running-dot shadow-[0_0_12px_rgba(103,210,143,0.38)]"
  }
  if (status === "failed" || status === "interrupted") {
    return "bg-rose-400"
  }
  if (status === "stale") {
    return "bg-stale-dot"
  }
  return "bg-muted"
}

const InfoRow = memo(function InfoRow({
  icon,
  label,
  value,
  mono = false
}: {
  icon: ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3 rounded-[18px] border border-border bg-detail px-3 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase text-muted">{label}</span>
        <span className={cn("block truncate text-[13px] text-fg", mono ? "font-mono" : "font-medium")}>{value}</span>
      </span>
    </div>
  )
})

export const ParamPanel = memo(function ParamPanel({
  className,
  session,
  detail,
  selectedThread,
  wrapSessionContent,
  defaultCwd,
  onWrapSessionContentChange
}: ParamPanelProps) {
  const thread = selectedThread ?? session?.thread ?? null
  const status = thread?.status ?? "idle"
  const model = thread?.model ?? "default Codex model"
  const tokenBudget = thread?.goalTokenBudget ?? null
  const contextTokens = detail?.tokensUsed ?? thread?.tokensUsed ?? session?.tokensUsed ?? 0
  const contextLimit = tokenBudget ?? Math.max(contextTokens, 1)
  const tokenRatio = tokenBudget ? clamp(contextTokens / tokenBudget, 0, 1) : 0
  const tokenPercent = Math.round(tokenRatio * 100)
  const turnCount = detail?.turns.length ?? 0
  const itemCount = detail?.items.length ?? 0

  return (
    <aside className={cn("flex h-full min-h-0 flex-col border-l border-border bg-panel text-fg", className)}>
      <div className="flex h-[72px] shrink-0 items-center justify-between gap-3 px-5">
        <div className="min-w-0">
          <h2 className="truncate text-[19px] font-semibold text-fg-strong">Run settings</h2>
          <p className="truncate text-[12px] text-muted">Thread and goal state</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-muted">
            <Server size={14} />
            Runtime
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between rounded-[18px] border border-border bg-detail px-4 py-3">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", runtimeStatusTone(status))} />
                <span className="truncate text-[14px] font-medium text-fg">{statusLabel(status)}</span>
              </span>
              <span className="rounded-full border border-border bg-control px-2 py-1 font-mono text-[10px] text-muted">app-server</span>
            </div>
            <InfoRow icon={<Bot size={14} />} label="Model" value={model} mono />
            <InfoRow icon={<Cpu size={14} />} label="Adapter" value="codex app-server --stdio" mono />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-muted">
            <ListTree size={14} />
            Session
          </div>
          <div className="grid gap-3">
            <InfoRow icon={<Hash size={14} />} label="Thread" value={thread ? shortId(thread.id) : "No thread selected"} mono />
            <InfoRow icon={<Hash size={14} />} label="Session" value={thread ? shortId(thread.sessionId) : "New session draft"} mono />
            <InfoRow icon={<Activity size={14} />} label="Active turn" value={thread?.activeTurnId ? shortId(thread.activeTurnId) : "None"} mono />
            <InfoRow icon={<FolderGit2 size={14} />} label="Working directory" value={thread?.cwd ?? session?.cwd ?? defaultCwd} mono />
            {thread?.forkedFromId ? <InfoRow icon={<GitFork size={14} />} label="Continued from" value={shortId(thread.forkedFromId)} mono /> : null}
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-muted">
            <TimerReset size={14} />
            Goal and Tokens
          </div>
          <div className="grid gap-3">
            <div className="rounded-[20px] border border-border bg-detail p-4">
              <div className="mb-3 flex items-center justify-between text-[13px]">
                <span className="font-medium text-fg">{tokenBudget ? "Goal budget" : "Tokens used"}</span>
                <span className="font-mono text-[11px] text-muted">
                  {tokenBudget ? `${formatCompact(contextTokens)} / ${formatCompact(contextLimit)}` : formatCompact(contextTokens)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-control">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                    tokenRatio > 0.82 ? "bg-stale-dot" : "bg-[#cfd8ff]",
                    tokenBudget ? null : "w-0"
                  )}
                  style={{ width: tokenBudget ? `${tokenPercent}%` : "0%" }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                <span>{thread?.goalStatus ? statusLabel(thread.goalStatus) : "No active goal"}</span>
                <span>{tokenBudget ? `${tokenPercent}%` : `${formatTokens(contextTokens)} total`}</span>
              </div>
            </div>
            {thread?.goalObjective ? (
              <div className="rounded-[18px] border border-border bg-detail px-4 py-3 text-[13px] leading-6 text-fg">
                {thread.goalObjective}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <InfoRow icon={<Play size={14} />} label="Turns" value={String(turnCount)} />
              <InfoRow icon={<CircleDotDashed size={14} />} label="Items" value={String(itemCount)} />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-muted">
            <SlidersHorizontal size={14} />
            Transcript View
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              className={cn(
                "flex min-h-14 items-center justify-between gap-3 rounded-[20px] border border-border bg-detail px-4 py-3 text-left text-[14px] font-medium transition duration-150 ease-out hover:bg-surface hover:text-fg-strong",
                wrapSessionContent ? "text-fg-strong" : "text-muted-strong"
              )}
              aria-pressed={wrapSessionContent}
              onClick={() => onWrapSessionContentChange(!wrapSessionContent)}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <WrapText size={16} className={cn("shrink-0", wrapSessionContent ? "text-[#cfd8ff]" : "text-muted")} />
                <span className="min-w-0">
                  <span className={cn("block truncate", wrapSessionContent ? "text-fg-strong" : "text-fg")}>Wrap session content</span>
                  <span className="block truncate text-[12px] font-normal text-muted">
                    {wrapSessionContent ? "Long transcript lines wrap" : "Long transcript lines scroll"}
                  </span>
                </span>
              </span>
              <span
                className={cn(
                  "relative h-8 w-14 shrink-0 rounded-full border border-border transition duration-150 ease-out",
                  wrapSessionContent ? "bg-neutral-100" : "bg-control"
                )}
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "absolute top-1 h-6 w-6 rounded-full transition duration-150 ease-out",
                    wrapSessionContent ? "left-7 bg-[#1a1a1a]" : "left-1 bg-muted"
                  )}
                />
              </span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  )
})
