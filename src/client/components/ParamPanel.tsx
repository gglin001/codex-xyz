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
import { memo } from "react"
import type { ReactNode } from "react"
import type { ControlThread, ThreadDetail } from "../../server/domain.js"
import { cn, tone } from "../designSystem.js"
import { formatTokens, shortId, statusLabel } from "../uiFormat.js"
import { ControlCard, InfoTile, Pill, SettingsSection, SurfaceAction, SwitchControl } from "./uiPrimitives.js"
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

function runtimeStatusTone(status: string | null | undefined) {
  if (status === "running") {
    return tone.running.dot
  }
  if (status === "failed" || status === "interrupted") {
    return tone.error.dot
  }
  if (status === "stale") {
    return tone.stale.dot
  }
  return tone.neutral.dot
}

function SettingsToggleRow({
  checked,
  icon,
  title,
  description,
  onClick
}: {
  checked: boolean
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <SurfaceAction
      className={cn("min-h-14 w-full justify-between gap-3 px-4 py-3 text-[14px] font-medium", checked ? null : "text-muted-strong")}
      selected={checked}
      onClick={onClick}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className={cn("shrink-0", checked ? "text-accent" : "text-muted")}>{icon}</span>
        <span className="min-w-0">
          <span className={cn("block truncate", checked ? "text-fg-strong" : "text-fg")}>{title}</span>
          <span className="block truncate text-[12px] font-normal text-muted">
            {description}
          </span>
        </span>
      </span>
      <SwitchControl checked={checked} />
    </SurfaceAction>
  )
}

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
        <SettingsSection icon={<Server size={14} />} title="Runtime">
          <div className="grid gap-3">
            <ControlCard className="flex items-center justify-between px-4 py-3">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", runtimeStatusTone(status))} />
                <span className="truncate text-[14px] font-medium text-fg">{statusLabel(status)}</span>
              </span>
              <Pill className="font-mono text-[10px] text-muted">app-server</Pill>
            </ControlCard>
            <InfoTile icon={<Bot size={14} />} label="Model" value={model} mono />
            <InfoTile icon={<Cpu size={14} />} label="Adapter" value="codex app-server --stdio" mono />
          </div>
        </SettingsSection>

        <SettingsSection icon={<ListTree size={14} />} title="Session">
          <div className="grid gap-3">
            <InfoTile icon={<Hash size={14} />} label="Thread" value={thread ? shortId(thread.id) : "No thread selected"} mono />
            <InfoTile icon={<Hash size={14} />} label="Session" value={thread ? shortId(thread.sessionId) : "New session draft"} mono />
            <InfoTile icon={<Activity size={14} />} label="Active turn" value={thread?.activeTurnId ? shortId(thread.activeTurnId) : "None"} mono />
            <InfoTile icon={<FolderGit2 size={14} />} label="Working directory" value={thread?.cwd ?? session?.cwd ?? defaultCwd} mono />
            {thread?.forkedFromId ? <InfoTile icon={<GitFork size={14} />} label="Continued from" value={shortId(thread.forkedFromId)} mono /> : null}
          </div>
        </SettingsSection>

        <SettingsSection icon={<TimerReset size={14} />} title="Goal and Tokens">
          <div className="grid gap-3">
            <ControlCard size="large" className="p-4">
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
                    tokenRatio > 0.82 ? "bg-stale-dot" : "bg-accent",
                    tokenBudget ? null : "w-0"
                  )}
                  style={{ width: tokenBudget ? `${tokenPercent}%` : "0%" }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                <span>{thread?.goalStatus ? statusLabel(thread.goalStatus) : "No active goal"}</span>
                <span>{tokenBudget ? `${tokenPercent}%` : `${formatTokens(contextTokens)} total`}</span>
              </div>
            </ControlCard>
            {thread?.goalObjective ? (
              <ControlCard className="px-4 py-3 text-[13px] leading-6 text-fg">
                {thread.goalObjective}
              </ControlCard>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <InfoTile icon={<Play size={14} />} label="Turns" value={String(turnCount)} />
              <InfoTile icon={<CircleDotDashed size={14} />} label="Items" value={String(itemCount)} />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection icon={<SlidersHorizontal size={14} />} title="Transcript View">
          <div className="grid gap-2">
            <SettingsToggleRow
              checked={wrapSessionContent}
              icon={<WrapText size={16} />}
              title="Wrap session content"
              description={wrapSessionContent ? "Long transcript lines wrap" : "Long transcript lines scroll"}
              onClick={() => onWrapSessionContentChange(!wrapSessionContent)}
            />
          </div>
        </SettingsSection>
      </div>
    </aside>
  )
})
