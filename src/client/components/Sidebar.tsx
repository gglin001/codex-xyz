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
  Settings,
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
  emerald: "border-emerald-400/30 bg-emerald-400/12 text-emerald-100",
  violet: "border-violet-400/30 bg-violet-400/12 text-violet-100",
  sky: "border-sky-400/30 bg-sky-400/12 text-sky-100",
  slate: "border-slate-600/70 bg-slate-800/70 text-slate-100"
}

const statusClass = {
  running: "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]",
  idle: "bg-slate-500",
  stale: "bg-violet-400",
  interrupted: "bg-rose-400",
  failed: "bg-rose-400",
  completed: "bg-slate-600"
} as const

function statusIcon(session: WorkbenchSession) {
  if (session.status === "running") {
    return <Loader2 size={13} className="animate-spin text-emerald-300" />
  }
  if (session.status === "idle") {
    return <CirclePause size={13} className="text-slate-500" />
  }
  if (session.status === "completed") {
    return <CircleStop size={13} className="text-slate-500" />
  }
  if (session.status === "stale") {
    return <CircleDotDashed size={13} className="text-violet-300" />
  }
  return <Circle size={13} className="text-rose-300" />
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
    <aside className={cn("flex h-full min-h-0 flex-col border-r border-slate-800/80 bg-slate-950/80 text-slate-200", className)}>
      <div className="relative shrink-0 border-b border-slate-800/80 p-3">
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-md border border-slate-800/80 bg-slate-900/60 px-2.5 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/50"
          title={selectedProject ? projectTitle(selectedProject) : "Switch project"}
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((current) => !current)}
        >
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
              selectedProject ? accentClass[selectedProject.accent] : "border-slate-800 bg-slate-900 text-slate-300"
            )}
            aria-hidden="true"
          >
            {selectedProject?.initials ?? "CX"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-slate-100">{selectedProject?.name ?? "Project"}</span>
            <span className="block truncate text-[11px] text-slate-500">{selectedProject?.path ?? "No project selected"}</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-slate-500" />
        </button>

        <AnimatePresence>
          {projectMenuOpen ? (
            <motion.div
              className="absolute left-3 right-3 top-[62px] z-30 overflow-hidden rounded-lg border border-slate-800/90 bg-slate-950/95 p-1 shadow-2xl backdrop-blur-md"
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
                  className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left transition duration-150 ease-out hover:bg-slate-800/60"
                  role="menuitem"
                  onClick={() => {
                    onProjectChange(project.id)
                    setProjectMenuOpen(false)
                  }}
                >
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold", accentClass[project.accent])}>
                    {project.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-100">{project.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {project.totalSessions} sessions / {formatTokens(project.tokenTotal)} tokens
                    </span>
                  </span>
                  {project.id === selectedProjectId ? <Check size={15} className="text-emerald-300" /> : null}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="shrink-0 border-b border-slate-800/80 px-3 py-3">
        <label className="flex h-9 items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/70 px-2.5 text-slate-500 transition duration-150 ease-out focus-within:border-slate-700 focus-within:bg-slate-900/70 focus-within:text-slate-300">
          <Search size={15} />
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>
        <button
          type="button"
          className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-800/80 bg-slate-900/55 text-[13px] font-medium text-slate-200 transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/60"
          onClick={onCreateSession}
        >
          <Plus size={15} />
          New session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={selectedProject?.id ?? "empty"}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="grid gap-4"
          >
            {sessionGroups.length === 0 ? (
              <div className="mx-1 rounded-md border border-dashed border-slate-800/80 bg-slate-900/30 px-3 py-8 text-center text-[13px] text-slate-500">
                {sessionQuery.trim() ? "No matching sessions" : "No Codex sessions yet"}
              </div>
            ) : null}
            {sessionGroups.map((group) => (
              <section key={group.bucket} className="grid gap-1">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                  {group.bucket}
                </div>
                {group.sessions.map((session) => {
                  const selected = selectedSessionId === session.id || selectedSessionId === session.threadId
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className={cn(
                        "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition duration-150 ease-out hover:bg-slate-800/50",
                        selected ? "bg-slate-800/70 text-slate-100 ring-1 ring-slate-700/70" : "text-slate-300"
                      )}
                      title={`${session.title}\n${session.cwd}`}
                      onClick={() => onSelectSession(session)}
                    >
                      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                        {statusIcon(session)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium leading-5">{session.title}</span>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusClass[session.status])} />
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{session.preview}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-2 text-[10px] uppercase tracking-[0.06em] text-slate-600">
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

      <div className="shrink-0 border-t border-slate-800/80 p-3">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(
              "flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-slate-800/80 px-2 text-[12px] font-medium transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100",
              terminalVisible ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-900/45 text-slate-500"
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
              "flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-slate-800/80 px-2 text-[12px] font-medium transition duration-150 ease-out hover:bg-slate-800/60 hover:text-slate-100",
              inspectorVisible ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-900/45 text-slate-500"
            )}
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-pressed={inspectorVisible}
            onClick={onToggleInspector}
          >
            <Settings size={15} />
            <span className="truncate">Settings</span>
          </button>
        </div>

        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-md border border-slate-800/80 bg-slate-900/45 px-2 text-left transition duration-150 ease-out hover:border-slate-700 hover:bg-slate-800/50"
          onClick={onOpenCommandPalette}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-300">
            <UserRound size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-slate-200">Local operator</span>
            <span className="block text-[11px] text-slate-600">Press ⌘K</span>
          </span>
          <Command size={14} className="text-slate-600" />
        </button>
      </div>
    </aside>
  )
})
