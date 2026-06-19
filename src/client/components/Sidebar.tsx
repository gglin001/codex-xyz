import {
  Check,
  ChevronDown,
  Circle,
  CircleDotDashed,
  CirclePause,
  CircleStop,
  Command,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Terminal,
  UserRound
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { memo, useMemo, useState } from "react"
import { cn } from "../classNames.js"
import { formatTime, formatTokens, statusLabel } from "../uiFormat.js"
import type { DateBucket, ProjectAccent, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

export type SidebarProps = {
  className?: string
  projects: WorkbenchProject[]
  selectedProjectId: string
  selectedSessionId: string | null
  sessionQuery: string
  onProjectChange: (projectId: string) => void
  onSessionQueryChange: (value: string) => void
  onSelectSession: (session: WorkbenchSession) => void
  onCreateSession: () => void
  terminalVisible: boolean
  onToggleTerminal: () => void
  inspectorVisible: boolean
  onToggleInspector: () => void
  onOpenCommandPalette: () => void
}

const bucketOrder: DateBucket[] = ["Today", "Yesterday", "Older"]

const accentClass: Record<ProjectAccent, string> = {
  emerald: "border-emerald-300/20 bg-emerald-400/15 text-emerald-100",
  violet: "border-violet-300/20 bg-violet-400/15 text-violet-100",
  sky: "border-white/10 bg-[#333333] text-neutral-100",
  slate: "border-white/10 bg-[#343434] text-neutral-100"
}

const statusClass = {
  running: "bg-running-dot shadow-[0_0_12px_rgba(103,210,143,0.38)]",
  idle: "bg-muted",
  stale: "bg-stale-dot",
  interrupted: "bg-rose-400",
  failed: "bg-rose-400",
  completed: "bg-completed-dot"
} as const

function statusIcon(session: WorkbenchSession) {
  if (session.status === "running") {
    return <Loader2 size={15} className="animate-spin text-running-dot" />
  }
  if (session.status === "idle") {
    return <CirclePause size={15} className="text-muted" />
  }
  if (session.status === "completed") {
    return <CircleStop size={15} className="text-muted" />
  }
  if (session.status === "stale") {
    return <CircleDotDashed size={15} className="text-stale-dot" />
  }
  return <Circle size={15} className="text-rose-300" />
}

function projectTitle(project: WorkbenchProject) {
  const parts = [
    project.path,
    `${project.totalSessions} sessions`,
    `${formatTokens(project.tokenTotal)} tokens`
  ]
  if (project.runningSessions > 0) {
    parts.push(`${project.runningSessions} running`)
  }
  return parts.join("\n")
}

function filterSessions(project: WorkbenchProject, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return project.sessions
  }
  return project.sessions.filter((session) => {
    const fields = [
      session.title,
      session.preview,
      session.cwd,
      session.model ?? "",
      session.status
    ]
    return fields.some((field) => field.toLowerCase().includes(normalized))
  })
}

function groupSessions(sessions: WorkbenchSession[]) {
  const grouped = new Map<DateBucket, WorkbenchSession[]>()
  for (const bucket of bucketOrder) {
    grouped.set(bucket, [])
  }
  for (const session of sessions) {
    grouped.get(session.dateBucket)?.push(session)
  }
  return bucketOrder
    .map((bucket) => ({
      bucket,
      sessions: grouped.get(bucket) ?? []
    }))
    .filter((group) => group.sessions.length > 0)
}

export const Sidebar = memo(function Sidebar({
  className,
  projects,
  selectedProjectId,
  selectedSessionId,
  sessionQuery,
  onProjectChange,
  onSessionQueryChange,
  onSelectSession,
  onCreateSession,
  terminalVisible,
  onToggleTerminal,
  inspectorVisible,
  onToggleInspector,
  onOpenCommandPalette
}: SidebarProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const visibleSessions = useMemo(
    () => (selectedProject ? filterSessions(selectedProject, sessionQuery) : []),
    [selectedProject, sessionQuery]
  )
  const sessionGroups = useMemo(() => groupSessions(visibleSessions), [visibleSessions])

  return (
    <aside className={cn("flex h-full min-h-0 flex-col border-r border-border bg-panel text-fg", className)}>
      <div className="relative shrink-0 p-4 pb-3">
        <button
          type="button"
          className="flex h-14 w-full items-center gap-3 rounded-[20px] border border-border bg-detail px-3 text-left shadow-control transition duration-150 ease-out hover:border-border-strong hover:bg-surface"
          title={selectedProject ? projectTitle(selectedProject) : "Switch project"}
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((current) => !current)}
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border text-[12px] font-semibold",
              selectedProject ? accentClass[selectedProject.accent] : "border-border bg-control text-fg"
            )}
            aria-hidden="true"
          >
            {selectedProject?.initials ?? "CX"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-semibold text-fg-strong">{selectedProject?.name ?? "Project"}</span>
            <span className="block truncate text-[12px] text-muted">{selectedProject?.path ?? "No project selected"}</span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-muted" />
        </button>

        <AnimatePresence>
          {projectMenuOpen ? (
            <motion.div
              className="absolute left-4 right-4 top-[76px] z-30 overflow-hidden rounded-[22px] border border-border bg-detail p-2 shadow-popover backdrop-blur-md"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              role="menu"
            >
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="flex h-12 w-full items-center gap-3 rounded-[16px] px-2.5 text-left transition duration-150 ease-out hover:bg-surface"
                  role="menuitem"
                  onClick={() => {
                    onProjectChange(project.id)
                    setProjectMenuOpen(false)
                  }}
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[13px] border text-[11px] font-semibold", accentClass[project.accent])}>
                    {project.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg-strong">{project.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {project.totalSessions} sessions / {formatTokens(project.tokenTotal)} tokens
                    </span>
                  </span>
                  {project.id === selectedProjectId ? <Check size={16} className="text-fg-strong" /> : null}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-4 py-3">
        <label className="flex h-12 items-center gap-3 rounded-[18px] border border-border bg-field px-3.5 text-muted transition duration-150 ease-out focus-within:border-border-strong focus-within:bg-surface focus-within:text-fg">
          <Search size={15} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-fg-strong placeholder:text-muted focus:outline-none"
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>
        <button
          type="button"
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[18px] border border-border bg-control text-[14px] font-medium text-fg transition duration-150 ease-out hover:border-border-strong hover:bg-control-hover hover:text-fg-strong"
          onClick={onCreateSession}
        >
          <Plus size={15} />
          New session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={selectedProject?.id ?? "empty"}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="grid gap-5"
          >
            {sessionGroups.length === 0 ? (
              <div className="mx-1 rounded-[20px] border border-dashed border-border bg-detail px-3 py-8 text-center text-[13px] text-muted">
                {sessionQuery.trim() ? "No matching sessions" : "No Codex sessions yet"}
              </div>
            ) : null}
            {sessionGroups.map((group) => (
              <section key={group.bucket} className="grid gap-1.5">
                <div className="px-3 pb-1 text-[12px] font-medium uppercase text-muted">
                  {group.bucket}
                </div>
                {group.sessions.map((session) => {
                  const selected = selectedSessionId === session.id || selectedSessionId === session.threadId
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-[18px] px-3 py-3 text-left transition duration-150 ease-out hover:bg-surface",
                        selected ? "bg-[#383838] text-fg-strong ring-1 ring-white/10" : "text-fg"
                      )}
                      title={`${session.title}\n${session.cwd}`}
                      onClick={() => onSelectSession(session)}
                    >
                      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                        {statusIcon(session)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[14px] font-medium leading-5">{session.title}</span>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusClass[session.status])} />
                        </span>
                        <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{session.preview}</span>
                        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[10px] uppercase text-muted">
                          <span>{formatTime(session.updatedAt)}</span>
                          <span>{statusLabel(session.status)}</span>
                          <span>{formatTokens(session.tokensUsed)}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 p-4 pt-3">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            className={cn(
              "flex h-12 min-w-0 items-center justify-center gap-2 rounded-[18px] border border-border px-2 text-[12px] font-medium transition duration-150 ease-out hover:bg-control-hover hover:text-fg-strong",
              terminalVisible ? "bg-[#383838] text-fg-strong" : "bg-detail text-muted-strong"
            )}
            title="Toggle terminal"
            aria-label="Toggle terminal"
            aria-pressed={terminalVisible}
            onClick={onToggleTerminal}
          >
            <Terminal size={15} />
            <span className="truncate">Terminal</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex h-12 min-w-0 items-center justify-center gap-2 rounded-[18px] border border-border px-2 text-[12px] font-medium transition duration-150 ease-out hover:bg-control-hover hover:text-fg-strong",
              inspectorVisible ? "bg-[#383838] text-fg-strong" : "bg-detail text-muted-strong"
            )}
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-pressed={inspectorVisible}
            onClick={onToggleInspector}
          >
            <SlidersHorizontal size={15} />
            <span className="truncate">Settings</span>
          </button>
        </div>

        <button
          type="button"
          className="flex h-14 w-full items-center gap-3 rounded-[20px] border border-border bg-detail px-3 text-left transition duration-150 ease-out hover:border-border-strong hover:bg-surface"
          onClick={onOpenCommandPalette}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-control text-fg">
            <UserRound size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg-strong">Local operator</span>
            <span className="block text-[11px] text-muted">Press ⌘K</span>
          </span>
          <Command size={15} className="text-muted" />
        </button>
      </div>
    </aside>
  )
})
