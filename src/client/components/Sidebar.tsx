import {
  Check,
  ChevronDown,
  Plus,
  Search,
  Settings,
  Terminal
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { memo, useMemo, useState } from "react"
import { cn, ui } from "../designSystem.js"
import { formatFullDateTime, formatTokens } from "../uiFormat.js"
import { AvatarBadge, ControlButton, ControlCard, FieldShell, MenuItemButton, NavAction, SurfaceAction } from "./uiPrimitives.js"
import { SessionStatusIcon, sessionStatusDotClass } from "./sessionStatusIcon.js"
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
      <div className="relative shrink-0 p-4 pb-2.5">
        <SurfaceAction
          className="h-12 w-full gap-2.5 px-3"
          title={selectedProject ? projectTitle(selectedProject) : "Switch project"}
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((current) => !current)}
        >
          <AvatarBadge className="h-8 w-8" aria-hidden="true">
            {selectedProject?.initials ?? "CX"}
          </AvatarBadge>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-fg-strong">{selectedProject?.name ?? "Project"}</span>
            <span className="block truncate text-[11px] text-muted">{selectedProject?.path ?? "No project selected"}</span>
          </span>
          <ChevronDown size={15} className="shrink-0 text-muted" />
        </SurfaceAction>

        <AnimatePresence>
          {projectMenuOpen ? (
            <motion.div
              className={cn("absolute left-4 right-4 top-[68px] z-30 p-2", ui.popover)}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              role="menu"
            >
              {projects.map((project) => (
                <MenuItemButton
                  key={project.id}
                  className="h-11 w-full gap-2.5 px-2.5"
                  role="menuitem"
                  selected={project.id === selectedProjectId}
                  onClick={() => {
                    onProjectChange(project.id)
                    setProjectMenuOpen(false)
                  }}
                >
                  <AvatarBadge className="h-7 w-7 text-[10px]">
                    {project.initials}
                  </AvatarBadge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg-strong">{project.name}</span>
                    <span className="block truncate text-[10px] text-muted">
                      {project.totalSessions} sessions / {formatTokens(project.tokenTotal)} tokens
                    </span>
                  </span>
                  {project.id === selectedProjectId ? <Check size={14} className="text-fg-strong" /> : null}
                </MenuItemButton>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
        <FieldShell icon={<Search size={14} />} className="min-w-0 flex-1">
          <input
            className={cn(ui.input, "text-[13px]")}
            value={sessionQuery}
            onChange={(event) => onSessionQueryChange(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </FieldShell>
        <ControlButton
          className="h-11 w-11 shrink-0 bg-transparent"
          onClick={onCreateSession}
          title="New session"
          aria-label="New session"
        >
          <Plus size={16} />
        </ControlButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
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
              <ControlCard className="border-dashed px-3 py-7 text-center text-[12px] text-muted">
                {sessionQuery.trim() ? "No matching sessions" : "No Codex sessions yet"}
              </ControlCard>
            ) : null}
            {sessionGroups.map((group) => (
              <section key={group.bucket} className="grid gap-1">
                <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-normal text-muted">
                  {group.bucket}
                </div>
                {group.sessions.map((session) => {
                  const selected = selectedSessionId === session.id || selectedSessionId === session.threadId
                  return (
                    <NavAction
                      key={session.id}
                      className={cn(
                        "group w-full items-start gap-2.5 px-3 py-2",
                        selected ? null : "bg-transparent"
                      )}
                      selected={selected}
                      title={`${session.title}\n${formatFullDateTime(session.updatedAt)}\n${session.preview}`}
                      onClick={() => onSelectSession(session)}
                    >
                      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                        <SessionStatusIcon status={session.status} />
                      </span>
                      <span className="grid min-w-0 flex-1 grid-rows-[20px_16px_18px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium leading-5">{session.title}</span>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sessionStatusDotClass[session.status])} />
                        </span>
                        <span className="truncate text-[10px] leading-4 text-muted">
                          {formatFullDateTime(session.updatedAt)} / {formatTokens(session.tokensUsed)} tokens
                        </span>
                        <span className="truncate text-[11px] leading-[18px] text-muted">{session.preview}</span>
                      </span>
                    </NavAction>
                  )
                })}
              </section>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 p-4 pt-2.5">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <SurfaceAction
            className={cn(
              "h-11 justify-center gap-2 px-2 text-[12px] font-medium",
              terminalVisible ? null : "text-muted-strong"
            )}
            title="Toggle terminal"
            aria-label="Toggle terminal"
            selected={terminalVisible}
            onClick={onToggleTerminal}
          >
            <Terminal size={14} />
            <span className="truncate">Terminal</span>
          </SurfaceAction>
          <SurfaceAction
            className={cn(
              "h-11 justify-center gap-2 px-2 text-[12px] font-medium",
              inspectorVisible ? null : "text-muted-strong"
            )}
            title={inspectorVisible ? "Hide settings" : "Open settings"}
            aria-label={inspectorVisible ? "Hide settings" : "Open settings"}
            selected={inspectorVisible}
            onClick={onToggleInspector}
          >
            <Settings size={14} />
            <span className="truncate">Settings</span>
          </SurfaceAction>
        </div>


        <SurfaceAction
          className="h-12 w-full gap-2.5 px-3"
          title="Open commands"
          aria-label="Open commands"
          onClick={onOpenCommandPalette}
        >
          <span className={cn("h-8 w-8 font-mono text-[16px] leading-none", ui.iconBox)} aria-hidden="true">
            ⌘
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-fg-strong">Commands</span>
          </span>
          <span className="shrink-0 font-mono text-[12px] leading-none text-muted" aria-hidden="true">cmd k</span>
        </SurfaceAction>
      </div>
    </aside>
  )
})
