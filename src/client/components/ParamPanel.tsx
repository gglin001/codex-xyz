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

const sectionClass = "border-b border-slate-800/60 px-4 py-4 last:border-b-0"

function runtimeStatusTone(status: string | null | undefined) {
  if (status === "running") {
    return "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]"
  }
  if (status === "failed" || status === "interrupted") {
    return "bg-rose-400"
  }
  if (status === "stale") {
    return "bg-violet-400"
  }
  return "bg-slate-500"
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
    <div className="flex items-start gap-2 rounded-md border border-slate-800/70 bg-slate-900/30 px-2.5 py-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-slate-600">{label}</span>
        <span className={cn("block truncate text-[12px] text-slate-300", mono ? "font-mono" : "font-medium")}>{value}</span>
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
    <aside className={cn("flex h-full min-h-0 flex-col border-l border-slate-800/80 bg-slate-950/80 text-slate-200", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/75 px-4 backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-slate-100">Codex Inspector</h2>
          <p className="truncate text-[11px] text-slate-500">app-server session state</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className={sectionClass}>
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <Server size={14} />
            Runtime
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-md border border-slate-800/70 bg-slate-900/30 px-3 py-2">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", runtimeStatusTone(status))} />
                <span className="truncate text-[13px] font-medium text-slate-200">{statusLabel(status)}</span>
              </span>
              <span className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">app-server</span>
            </div>
            <InfoRow icon={<Bot size={14} />} label="Model" value={model} mono />
            <InfoRow icon={<Cpu size={14} />} label="Adapter" value="codex app-server --stdio" mono />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <ListTree size={14} />
            Session
          </div>
          <div className="grid gap-2">
            <InfoRow icon={<Hash size={14} />} label="Thread" value={thread ? shortId(thread.id) : "No thread selected"} mono />
            <InfoRow icon={<Hash size={14} />} label="Session" value={thread ? shortId(thread.sessionId) : "New session draft"} mono />
            <InfoRow icon={<Activity size={14} />} label="Active turn" value={thread?.activeTurnId ? shortId(thread.activeTurnId) : "None"} mono />
            <InfoRow icon={<FolderGit2 size={14} />} label="Working directory" value={thread?.cwd ?? session?.cwd ?? defaultCwd} mono />
            {thread?.forkedFromId ? <InfoRow icon={<GitFork size={14} />} label="Continued from" value={shortId(thread.forkedFromId)} mono /> : null}
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <TimerReset size={14} />
            Goal and Tokens
          </div>
          <div className="grid gap-3">
            <div className="rounded-md border border-slate-800/80 bg-slate-900/40 p-3">
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="font-medium text-slate-300">{tokenBudget ? "Goal budget" : "Tokens used"}</span>
                <span className="font-mono text-[11px] text-slate-500">
                  {tokenBudget ? `${formatCompact(contextTokens)} / ${formatCompact(contextLimit)}` : formatCompact(contextTokens)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
                    tokenRatio > 0.82 ? "bg-violet-500" : "bg-emerald-500",
                    tokenBudget ? null : "w-0"
                  )}
                  style={{ width: tokenBudget ? `${tokenPercent}%` : "0%" }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>{thread?.goalStatus ? statusLabel(thread.goalStatus) : "No active goal"}</span>
                <span>{tokenBudget ? `${tokenPercent}%` : `${formatTokens(contextTokens)} total`}</span>
              </div>
            </div>
            {thread?.goalObjective ? (
              <div className="rounded-md border border-slate-800/70 bg-slate-900/30 px-3 py-2 text-[12px] leading-5 text-slate-300">
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
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <SlidersHorizontal size={14} />
            Settings
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-800/80 px-3 py-2 text-left text-[12px] font-medium transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100",
                wrapSessionContent ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-900/40 text-slate-500"
              )}
              aria-pressed={wrapSessionContent}
              onClick={() => onWrapSessionContentChange(!wrapSessionContent)}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <WrapText size={14} className={cn("shrink-0", wrapSessionContent ? "text-emerald-200" : "text-slate-500")} />
                <span className="min-w-0">
                  <span className={cn("block truncate", wrapSessionContent ? "text-emerald-100" : "text-slate-300")}>Wrap session content</span>
                  <span className={cn("block truncate text-[11px] font-normal", wrapSessionContent ? "text-emerald-300/75" : "text-slate-500")}>
                    {wrapSessionContent ? "Long transcript lines wrap" : "Long transcript lines scroll"}
                  </span>
                </span>
              </span>
              <span className={cn("shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em]", wrapSessionContent ? "text-emerald-200" : "text-slate-600")}>
                {wrapSessionContent ? "On" : "Off"}
              </span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  )
})
