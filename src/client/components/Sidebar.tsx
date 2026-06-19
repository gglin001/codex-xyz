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
import { cn, tone, ui } from "../designSystem.js"
import { formatTime, formatTokens, statusLabel } from "../uiFormat.js"
import { AvatarBadge, ControlButton, ControlCard, FieldShell, MenuItemButton, NavAction, SurfaceAction } from "./uiPrimitives.js"
import type { DateBucket, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

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

const statusClass = {
  running: tone.running.dot,
  idle: tone.neutral.dot,
  stale: tone.stale.dot,
  interrupted: tone.error.dot,
  failed: tone.error.dot,
  completed: tone.completed.dot
} as const

function statusIcon(session: WorkbenchSession) {
  if (session.status === "running") {
    return <Loader2 size={15} className={cn("animate-spin", tone.running.icon)} />
  }
  if (session.status === "idle") {
    return <CirclePause size={15} className={tone.completed.icon} />
  }
  if (session.status === "completed") {
    return <CircleStop size={15} className={tone.completed.icon} />
  }
  if (session.status === "stale") {
    return <CircleDotDashed size={15} className={tone.stale.icon} />
  }
  return <Circle size={15} className={tone.error.icon} />
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
    <aside className={cn("flex h-full min-h-0 flex-col border-r", ui.sidePanel, className)}>
      <div className="relative shrink-0 p-4 pb-3">
        <SurfaceAction
          className="h-14 w-full gap-3 px-3"
          title={selectedProject ? projectTitle(selectedProject) : "Switch project"}
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((current) => !current)}
        >
          <AvatarBadge className="h-9 w-9" aria-hidden="true">
            {selectedProject?.initials ?? "CX"}
          </AvatarBadge>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-semibold text-fg-strong">{selectedProject?.name ?? "Project"}</span>
            <span className="block truncate text-[12px] text-muted">{selectedProject?.path ?? "No project selected"}</span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-muted" />
        </SurfaceAction>

        <AnimatePresence>
          {projectMenuOpen ? (
            <motion.div
              className={cn("absolute left-4 right-4 top-[76px] z-30 p-2", ui.popover)}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              role="menu"
            >
              {projects.map((project) => (
                <MenuItemButton
                  key={project.id}
                  className="h-12 w-full gap-3 px-2.5"
                  role="menuitem"
                  selected={project.id === selectedProjectId}
                  onClick={() => {
                    onProjectChange(project.id)
                    setProjectMenuOpen(false)
                  }}
                >
                  <AvatarBadge className="h-8 w-8 text-[11px]">
                    {project.initials}
                  </AvatarBadge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg-strong">{project.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {project.totalSessions} sessions / {formatTokens(project.tokenTotal)} tokens
                    </span>
                  </span>
                  {project.id === selectedProjectId ? <Check size={16} className="text-fg-strong" /> : null}
                </MenuItemButton>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-4 py-3">
        <FieldShell icon={<Search size={15} />}>
          <input
            className={cn(ui.input, "text-[14px]")}
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </FieldShell>
        <ControlButton
          className="mt-3 h-12 w-full gap-2 text-[14px] font-medium"
          onClick={onCreateSession}
        >
          <Plus size={15} />
          New session
        </ControlButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={selectedProject?.id ?? "empty"}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="grid gap-6"
          >
            {sessionGroups.length === 0 ? (
              <ControlCard className="border-dashed px-3 py-8 text-center text-[13px] text-muted">
                {sessionQuery.trim() ? "No matching sessions" : "No Codex sessions yet"}
              </ControlCard>
            ) : null}
            {sessionGroups.map((group) => (
              <section key={group.bucket} className="grid gap-1">
                <div className="px-3 pb-2 text-[12px] font-medium uppercase tracking-normal text-muted">
                  {group.bucket}
                </div>
                {group.sessions.map((session) => {
                  const selected = selectedSessionId === session.id || selectedSessionId === session.threadId
                  return (
                    <NavAction
                      key={session.id}
                      className={cn(
                        "group w-full items-start gap-3 px-3 py-3",
                        selected ? null : "bg-transparent"
                      )}
                      selected={selected}
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
                    </NavAction>
                  )
                })}
              </section>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 p-4 pt-3">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <SurfaceAction
            className={cn(
              "h-12 justify-center gap-2 px-2 text-[12px] font-medium",
              terminalVisible ? null : "text-muted-strong"
            )}
            title="Toggle terminal"
            aria-label="Toggle terminal"
            selected={terminalVisible}
            onClick={onToggleTerminal}
          >
            <Terminal size={15} />
            <span className="truncate">Terminal</span>
          </SurfaceAction>
          <SurfaceAction
            className={cn(
              "h-12 justify-center gap-2 px-2 text-[12px] font-medium",
              inspectorVisible ? null : "text-muted-strong"
            )}
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            selected={inspectorVisible}
            onClick={onToggleInspector}
          >
            <SlidersHorizontal size={15} />
            <span className="truncate">Settings</span>
          </SurfaceAction>
        </div>

        <SurfaceAction
          className="h-14 w-full gap-3 px-3"
          onClick={onOpenCommandPalette}
        >
          <span className={cn("h-9 w-9", ui.iconBox)}>
            <UserRound size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg-strong">Local operator</span>
            <span className="block text-[11px] text-muted">Press ⌘K</span>
          </span>
          <Command size={15} className="text-muted" />
        </SurfaceAction>
      </div>
    </aside>
  )
})
