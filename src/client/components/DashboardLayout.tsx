import { Menu, Plus, Search, Settings } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import type { KeyboardEvent, SubmitEvent } from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ControlThread, SessionDisplayStatus, ThreadDetail } from "../../server/domain.js"
import { cn, ui } from "../designSystem.js"
import { isPromptFocusShortcut } from "../promptShortcut.js"
import { useVisualViewportHeight } from "../useVisualViewport.js"
import { useSwipeGesture } from "../useSwipeGesture.js"
import { ParamPanel } from "./ParamPanel.js"
import { Sidebar } from "./Sidebar.js"
import { Workspace, type WorkspaceHandle } from "./Workspace.js"
import { AvatarBadge, Keycap, MenuItemButton } from "./uiPrimitives.js"
import { SessionStatusIcon } from "./sessionStatusIcon.js"
import type { ComposerMode, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

export type DashboardLayoutProps = {
  projects: WorkbenchProject[]
  selectedProjectId: string
  selectedSessionId: string | null
  session: WorkbenchSession | null
  detail: ThreadDetail | null
  selectedThread: ControlThread | null
  selectedThreadId: string | null
  navigatorVisible: boolean
  inspectorVisible: boolean
  terminalVisible: boolean
  wrapSessionContent: boolean
  sessionQuery: string
  defaultCwd: string
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
  onNavigatorVisibleChange: (visible: boolean) => void
  onInspectorVisibleChange: (visible: boolean) => void
  onWrapSessionContentChange: (value: boolean) => void
  onProjectChange: (projectId: string) => void
  onSelectSession: (session: WorkbenchSession, options?: { clearSessionQuery?: boolean }) => void
  onCreateSession: () => void
  onSessionQueryChange: (value: string) => void
  onToggleTerminal: () => void
  onPromptChange: (value: string) => void
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPromptSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  onModeChange: (mode: ComposerMode) => void
  onWorkdirChange: (value: string) => void
  onGoalModeChange: (value: boolean) => void
  onInterrupt: () => void
  onResume: () => void
}

type CommandActionBase = {
  id: string
  title: string
  detail: string
  run: () => void
}

type CommandAction =
  | (CommandActionBase & {
    kind: "create" | "navigator" | "settings"
  })
  | (CommandActionBase & {
    kind: "project"
    projectId: string
    projectInitials: string
  })
  | (CommandActionBase & {
    kind: "session"
    projectId: string
    status: SessionDisplayStatus
  })

type CommandActionRenderItem = {
  action: CommandAction
  projectHasVisibleSessions: boolean
  lastVisibleProjectSession: boolean
}

const spring = { type: "spring", stiffness: 360, damping: 36 } as const

function commandActionMatches(action: CommandAction, normalizedQuery: string) {
  return `${action.title} ${action.detail}`.toLowerCase().includes(normalizedQuery)
}

function filterCommandActions(actions: CommandAction[], normalizedQuery: string) {
  if (!normalizedQuery) {
    return actions
  }

  const directMatches = new Set<string>()
  const projectsWithMatchingSessions = new Set<string>()

  for (const action of actions) {
    if (commandActionMatches(action, normalizedQuery)) {
      directMatches.add(action.id)
      if (action.kind === "session") {
        projectsWithMatchingSessions.add(action.projectId)
      }
    }
  }

  return actions.filter((action) => {
    if (directMatches.has(action.id)) {
      return true
    }
    return action.kind === "project" && projectsWithMatchingSessions.has(action.projectId)
  })
}

function annotateCommandActions(actions: CommandAction[]): CommandActionRenderItem[] {
  const visibleSessionCounts = new Map<string, number>()
  for (const action of actions) {
    if (action.kind === "session") {
      visibleSessionCounts.set(action.projectId, (visibleSessionCounts.get(action.projectId) ?? 0) + 1)
    }
  }

  const seenSessions = new Map<string, number>()
  return actions.map((action) => {
    if (action.kind === "project") {
      return {
        action,
        projectHasVisibleSessions: (visibleSessionCounts.get(action.projectId) ?? 0) > 0,
        lastVisibleProjectSession: false
      }
    }
    if (action.kind === "session") {
      const nextIndex = (seenSessions.get(action.projectId) ?? 0) + 1
      seenSessions.set(action.projectId, nextIndex)
      return {
        action,
        projectHasVisibleSessions: false,
        lastVisibleProjectSession: nextIndex === (visibleSessionCounts.get(action.projectId) ?? 0)
      }
    }
    return {
      action,
      projectHasVisibleSessions: false,
      lastVisibleProjectSession: false
    }
  })
}

function CommandActionGlyph({
  action,
  projectHasVisibleSessions,
  lastVisibleProjectSession
}: CommandActionRenderItem) {
  if (action.kind === "project") {
    return (
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
        {projectHasVisibleSessions ? (
          <span className="absolute left-4 top-8 h-2 border-l border-border" />
        ) : null}
        <AvatarBadge className="h-8 w-8 text-[10px]">
          {action.projectInitials}
        </AvatarBadge>
      </span>
    )
  }

  if (action.kind === "session") {
    return (
      <span className="relative flex h-8 w-12 shrink-0 items-center" aria-hidden="true">
        <span
          className={cn(
            "absolute left-2 border-l border-border",
            lastVisibleProjectSession ? "-top-2 h-6" : "-top-2 -bottom-2"
          )}
        />
        <span className="absolute left-2 top-4 w-3 border-t border-border" />
        <span className={cn("absolute right-0 top-0 h-8 w-8 border border-border text-muted-strong", ui.iconBox)}>
          <SessionStatusIcon status={action.status} />
        </span>
      </span>
    )
  }

  const icon = action.kind === "create"
    ? <Plus size={14} />
    : action.kind === "navigator"
      ? <Menu size={14} />
      : <Settings size={14} />

  return (
    <span className={cn("h-8 w-8 border border-border text-muted-strong", ui.iconBox)} aria-hidden="true">
      {icon}
    </span>
  )
}

const CommandPalette = memo(function CommandPalette({
  open,
  actions,
  onClose
}: {
  open: boolean
  actions: CommandAction[]
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)

  const filteredActions = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return filterCommandActions(actions, normalized)
  }, [actions, query])
  const renderItems = useMemo(() => annotateCommandActions(filteredActions), [filteredActions])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setActiveIndex(0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const runActive = useCallback(() => {
    const action = filteredActions[activeIndex]
    if (!action) {
      return
    }
    action.run()
    onClose()
  }, [activeIndex, filteredActions, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn("fixed inset-0 z-[120] flex items-start justify-center px-3 pt-[12vh]", ui.overlay)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
          onMouseDown={onClose}
        >
          <motion.div
            className={cn("w-full max-w-[640px]", ui.popover)}
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-14 items-center gap-3 border-b border-border px-4">
              <Search size={16} className="text-muted" />
              <input
                className={cn(ui.input, "h-12 text-[14px]")}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects, sessions, and panels"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    onClose()
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setActiveIndex((index) => Math.min(filteredActions.length - 1, index + 1))
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    setActiveIndex((index) => Math.max(0, index - 1))
                  }
                  if (event.key === "Enter") {
                    event.preventDefault()
                    runActive()
                  }
                }}
              />
              <Keycap>Esc</Keycap>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {filteredActions.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-muted">No commands found</div>
              ) : null}
              {renderItems.map(({ action, projectHasVisibleSessions, lastVisibleProjectSession }, index) => (
                <MenuItemButton
                  key={action.id}
                  className={cn(
                    "h-12 w-full gap-2.5 px-3",
                    index === activeIndex ? null : "bg-transparent"
                  )}
                  selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    action.run()
                    onClose()
                  }}
                >
                  <CommandActionGlyph
                    action={action}
                    projectHasVisibleSessions={projectHasVisibleSessions}
                    lastVisibleProjectSession={lastVisibleProjectSession}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{action.title}</span>
                    <span className="block truncate text-[11px] text-muted">{action.detail}</span>
                  </span>
                </MenuItemButton>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})

export const DashboardLayout = memo(function DashboardLayout({
  projects,
  selectedProjectId,
  selectedSessionId,
  session,
  detail,
  selectedThread,
  selectedThreadId,
  navigatorVisible,
  inspectorVisible,
  terminalVisible,
  wrapSessionContent,
  sessionQuery,
  defaultCwd,
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
  onNavigatorVisibleChange,
  onInspectorVisibleChange,
  onWrapSessionContentChange,
  onProjectChange,
  onSelectSession,
  onCreateSession,
  onSessionQueryChange,
  onToggleTerminal,
  onPromptChange,
  onPromptKeyDown,
  onPromptSubmit,
  onModeChange,
  onWorkdirChange,
  onGoalModeChange,
  onInterrupt,
  onResume
}: DashboardLayoutProps) {
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const desktopWorkspaceRef = useRef<WorkspaceHandle | null>(null)
  const mobileWorkspaceRef = useRef<WorkspaceHandle | null>(null)
  const vvHeight = useVisualViewportHeight({ maxWidth: 767 })
  const navigatorBackdropRef = useRef<HTMLDivElement | null>(null)
  const inspectorBackdropRef = useRef<HTMLDivElement | null>(null)

  const handleSwipeRight = useCallback(() => {
    if (mobileInspectorOpen) {
      setMobileInspectorOpen(false)
    } else {
      setMobileNavigatorOpen(true)
    }
  }, [mobileInspectorOpen])

  const handleSwipeLeft = useCallback(() => {
    if (mobileNavigatorOpen) {
      setMobileNavigatorOpen(false)
    } else {
      setMobileInspectorOpen(true)
    }
  }, [mobileNavigatorOpen])

  useSwipeGesture(navigatorBackdropRef, {
    onSwipeLeft: () => setMobileNavigatorOpen(false)
  })

  useSwipeGesture(inspectorBackdropRef, {
    onSwipeRight: () => setMobileInspectorOpen(false)
  })

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null

  const focusVisiblePrompt = useCallback(() => {
    const useDesktopWorkspace = typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 768px)").matches
      : true
    const workspace = useDesktopWorkspace ? desktopWorkspaceRef.current : mobileWorkspaceRef.current
    return workspace?.focusPrompt() ?? false
  }, [])

  const createSessionAndFocusPrompt = useCallback(() => {
    onCreateSession()
    window.requestAnimationFrame(focusVisiblePrompt)
  }, [focusVisiblePrompt, onCreateSession])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommandOpen(false)
        setMobileNavigatorOpen(false)
        setMobileInspectorOpen(false)
        return
      }
      if (!commandOpen && isPromptFocusShortcut(event)) {
        event.preventDefault()
        setMobileNavigatorOpen(false)
        setMobileInspectorOpen(false)
        window.requestAnimationFrame(focusVisiblePrompt)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setMobileNavigatorOpen(false)
        setMobileInspectorOpen(false)
        setCommandOpen((current) => !current)
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [commandOpen, focusVisiblePrompt])

  const commandActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      {
        id: "create-session",
        title: "Create new session",
        detail: "Start a fresh Codex app-server session",
        kind: "create",
        run: createSessionAndFocusPrompt
      },
      {
        id: "toggle-navigator",
        title: navigatorVisible ? "Hide navigator" : "Show navigator",
        detail: "Toggle the project and session sidebar",
        kind: "navigator",
        run: () => onNavigatorVisibleChange(!navigatorVisible)
      },
      {
        id: "toggle-inspector",
        title: inspectorVisible ? "Hide settings" : "Show settings",
        detail: "Toggle app-server thread and goal state",
        kind: "settings",
        run: () => onInspectorVisibleChange(!inspectorVisible)
      }
    ]

    for (const project of projects) {
      actions.push({
        id: `project:${project.id}`,
        title: `Switch to ${project.name}`,
        detail: project.path,
        kind: "project",
        projectId: project.id,
        projectInitials: project.initials,
        run: () => onProjectChange(project.id)
      })
      for (const projectSession of project.sessions) {
        actions.push({
          id: `session:${projectSession.id}`,
          title: projectSession.title,
          detail: `${project.name} / ${projectSession.cwd}`,
          kind: "session",
          projectId: project.id,
          status: projectSession.status,
          run: () => {
            onSelectSession(projectSession, { clearSessionQuery: true })
          }
        })
      }
    }

    return actions
  }, [
    inspectorVisible,
    navigatorVisible,
    createSessionAndFocusPrompt,
    onInspectorVisibleChange,
    onNavigatorVisibleChange,
    onProjectChange,
    onSelectSession,
    projects
  ])

  const sidebar = (
    <Sidebar
      projects={projects}
      selectedProjectId={selectedProjectId}
      selectedSessionId={selectedSessionId}
      sessionQuery={sessionQuery}
      onProjectChange={onProjectChange}
      onSessionQueryChange={onSessionQueryChange}
      onSelectSession={onSelectSession}
      onCreateSession={createSessionAndFocusPrompt}
      terminalVisible={terminalVisible}
      onToggleTerminal={onToggleTerminal}
      inspectorVisible={inspectorVisible}
      onToggleInspector={() => onInspectorVisibleChange(!inspectorVisible)}
      onOpenCommandPalette={() => setCommandOpen(true)}
    />
  )

  const inspector = (
    <ParamPanel
      session={session}
      detail={detail}
      selectedThread={selectedThread}
      wrapSessionContent={wrapSessionContent}
      defaultCwd={defaultCwd}
      onWrapSessionContentChange={onWrapSessionContentChange}
    />
  )

  return (
    <main
      className={cn("h-dvh min-h-0 w-full overflow-hidden", ui.appShell)}
      style={vvHeight != null ? { height: `${vvHeight}px` } : undefined}
    >
      <div className="hidden h-full min-h-0 md:flex">
        <AnimatePresence initial={false}>
          {navigatorVisible ? (
            <motion.div
              key="desktop-sidebar"
              className="h-full min-h-0 shrink-0 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={spring}
            >
              {sidebar}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="min-h-0 min-w-0 flex-1">
          <Workspace
            ref={desktopWorkspaceRef}
            project={selectedProject}
            session={session}
            detail={detail}
            selectedThread={selectedThread}
            selectedThreadId={selectedThreadId}
            workdir={workdir}
            busy={busy}
            busyAction={busyAction}
            notice={notice}
            error={error}
            prompt={prompt}
            promptTarget={promptTarget}
            goalMode={goalMode}
            canUseGoalMode={canUseGoalMode}
            canSubmitPrompt={canSubmitPrompt}
            wrapSessionContent={wrapSessionContent}
            navigatorVisible={navigatorVisible}
            inspectorVisible={inspectorVisible}
            onPromptChange={onPromptChange}
            onPromptKeyDown={onPromptKeyDown}
            onPromptSubmit={onPromptSubmit}
            onModeChange={onModeChange}
            onWorkdirChange={onWorkdirChange}
            onGoalModeChange={onGoalModeChange}
            onInterrupt={onInterrupt}
            onResume={onResume}
            onToggleNavigator={() => onNavigatorVisibleChange(!navigatorVisible)}
            onToggleInspector={() => onInspectorVisibleChange(!inspectorVisible)}
          />
        </div>

        <AnimatePresence initial={false}>
          {inspectorVisible ? (
            <motion.div
              key="desktop-inspector"
              className="h-full min-h-0 shrink-0 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={spring}
            >
              {inspector}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="h-full min-h-0 md:hidden">
        <Workspace
          ref={mobileWorkspaceRef}
          project={selectedProject}
          session={session}
          detail={detail}
          selectedThread={selectedThread}
          selectedThreadId={selectedThreadId}
          workdir={workdir}
          busy={busy}
          busyAction={busyAction}
          notice={notice}
          error={error}
          prompt={prompt}
          promptTarget={promptTarget}
          goalMode={goalMode}
          canUseGoalMode={canUseGoalMode}
          canSubmitPrompt={canSubmitPrompt}
          wrapSessionContent={wrapSessionContent}
          navigatorVisible={mobileNavigatorOpen}
          inspectorVisible={mobileInspectorOpen}
          onPromptChange={onPromptChange}
          onPromptKeyDown={onPromptKeyDown}
          onPromptSubmit={onPromptSubmit}
          onModeChange={onModeChange}
          onWorkdirChange={onWorkdirChange}
          onGoalModeChange={onGoalModeChange}
          onInterrupt={onInterrupt}
          onResume={onResume}
          onToggleNavigator={() => {
            setMobileInspectorOpen(false)
            setMobileNavigatorOpen((current) => !current)
          }}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
          onToggleInspector={() => {
            setMobileNavigatorOpen(false)
            setMobileInspectorOpen((current) => !current)
          }}
        />
      </div>

      <AnimatePresence>
        {mobileNavigatorOpen ? (
          <motion.div
            ref={navigatorBackdropRef}
            className={cn("fixed inset-0 z-[90] md:hidden", ui.overlay)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onMouseDown={() => setMobileNavigatorOpen(false)}
          >
            <motion.div
              className={cn("h-full w-[min(88vw,360px)] overflow-hidden border-r", ui.backdropPanel)}
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={spring}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <Sidebar
                projects={projects}
                selectedProjectId={selectedProjectId}
                selectedSessionId={selectedSessionId}
                sessionQuery={sessionQuery}
                onProjectChange={onProjectChange}
                onSessionQueryChange={onSessionQueryChange}
                onSelectSession={(nextSession) => {
                  onSelectSession(nextSession)
                  setMobileNavigatorOpen(false)
                }}
                onCreateSession={() => {
                  createSessionAndFocusPrompt()
                  setMobileNavigatorOpen(false)
                }}
                terminalVisible={terminalVisible}
                onToggleTerminal={onToggleTerminal}
                inspectorVisible={mobileInspectorOpen}
                onToggleInspector={() => {
                  setMobileNavigatorOpen(false)
                  setMobileInspectorOpen((current) => !current)
                }}
                onOpenCommandPalette={() => {
                  setMobileNavigatorOpen(false)
                  setCommandOpen(true)
                }}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {mobileInspectorOpen ? (
          <motion.div
            ref={inspectorBackdropRef}
            className={cn("fixed inset-0 z-[95] md:hidden", ui.overlay)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onMouseDown={() => setMobileInspectorOpen(false)}
          >
            <motion.div
              className={cn("h-full w-[min(88vw,360px)] ml-auto overflow-hidden border-l", ui.backdropPanel)}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={spring}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <ParamPanel
                session={session}
                detail={detail}
                selectedThread={selectedThread}
                wrapSessionContent={wrapSessionContent}
                defaultCwd={defaultCwd}
                onWrapSessionContentChange={onWrapSessionContentChange}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />
    </main>
  )
})
