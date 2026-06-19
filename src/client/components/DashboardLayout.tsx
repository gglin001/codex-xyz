import { Command, PanelLeftOpen, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import type { FormEvent, KeyboardEvent } from "react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import type { ControlThread, ThreadDetail } from "../../server/domain.js"
import { cn } from "../classNames.js"
import { ParamPanel } from "./ParamPanel.js"
import { Sidebar } from "./Sidebar.js"
import { Workspace } from "./Workspace.js"
import type { ComposerMode, ParameterState, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

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
  sessionQuery: string
  params: ParameterState
  contextTokens: number
  contextLimit: number
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
  onProjectChange: (projectId: string) => void
  onSelectSession: (session: WorkbenchSession) => void
  onCreateSession: () => void
  onSessionQueryChange: (value: string) => void
  onToggleTerminal: () => void
  onParamChange: (params: ParameterState) => void
  onPromptChange: (value: string) => void
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPromptSubmit: (event: FormEvent) => void
  onModeChange: (mode: ComposerMode) => void
  onWorkdirChange: (value: string) => void
  onGoalModeChange: (value: boolean) => void
  onInterrupt: () => void
  onResume: () => void
}

type CommandAction = {
  id: string
  title: string
  detail: string
  icon: "project" | "session" | "panel" | "create"
  run: () => void
}

const spring = { type: "spring", stiffness: 360, damping: 36 } as const

function commandIcon(icon: CommandAction["icon"]) {
  if (icon === "project") {
    return <PanelLeftOpen size={15} />
  }
  if (icon === "panel") {
    return <SlidersHorizontal size={15} />
  }
  if (icon === "create") {
    return <Plus size={15} />
  }
  return <Command size={15} />
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
    if (!normalized) {
      return actions
    }
    return actions.filter((action) => {
      return `${action.title} ${action.detail}`.toLowerCase().includes(normalized)
    })
  }, [actions, query])

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
          className="fixed inset-0 z-[120] flex items-start justify-center bg-black/55 px-3 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
          onMouseDown={onClose}
        >
          <motion.div
            className="w-full max-w-[640px] overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur-md"
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex h-13 items-center gap-3 border-b border-slate-800/80 px-4">
              <Search size={17} className="text-slate-500" />
              <input
                className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
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
              <span className="rounded border border-slate-800 bg-slate-900 px-1.5 py-1 font-mono text-[10px] text-slate-500">Esc</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-1.5">
              {filteredActions.length === 0 ? (
                <div className="px-3 py-8 text-center text-[13px] text-slate-500">No commands found</div>
              ) : null}
              {filteredActions.map((action, index) => (
                <button
                  key={action.id}
                  type="button"
                  className={cn(
                    "flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition duration-150 ease-out",
                    index === activeIndex ? "bg-slate-800/70 text-slate-100" : "text-slate-300 hover:bg-slate-800/45"
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    action.run()
                    onClose()
                  }}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-400">
                    {commandIcon(action.icon)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{action.title}</span>
                    <span className="block truncate text-[11px] text-slate-500">{action.detail}</span>
                  </span>
                </button>
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
  sessionQuery,
  params,
  contextTokens,
  contextLimit,
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
  onProjectChange,
  onSelectSession,
  onCreateSession,
  onSessionQueryChange,
  onToggleTerminal,
  onParamChange,
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
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommandOpen(false)
        setMobileNavigatorOpen(false)
        setMobileInspectorOpen(false)
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
  }, [])

  const commandActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      {
        id: "create-session",
        title: "Create new session",
        detail: "Start a fresh Codex playground in the composer",
        icon: "create",
        run: onCreateSession
      },
      {
        id: "toggle-navigator",
        title: navigatorVisible ? "Hide navigator" : "Show navigator",
        detail: "Toggle the project and session sidebar",
        icon: "panel",
        run: () => onNavigatorVisibleChange(!navigatorVisible)
      },
      {
        id: "toggle-inspector",
        title: inspectorVisible ? "Hide inspector" : "Show inspector",
        detail: "Toggle model parameters and context metrics",
        icon: "panel",
        run: () => onInspectorVisibleChange(!inspectorVisible)
      }
    ]

    for (const project of projects) {
      actions.push({
        id: `project:${project.id}`,
        title: `Switch to ${project.name}`,
        detail: project.path,
        icon: "project",
        run: () => onProjectChange(project.id)
      })
      for (const projectSession of project.sessions.slice(0, 4)) {
        actions.push({
          id: `session:${projectSession.id}`,
          title: projectSession.title,
          detail: `${project.name} / ${projectSession.cwd}`,
          icon: "session",
          run: () => {
            onProjectChange(project.id)
            onSelectSession(projectSession)
          }
        })
      }
    }

    return actions
  }, [
    inspectorVisible,
    navigatorVisible,
    onCreateSession,
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
      terminalVisible={terminalVisible}
      onProjectChange={onProjectChange}
      onSessionQueryChange={onSessionQueryChange}
      onSelectSession={onSelectSession}
      onCreateSession={onCreateSession}
      onToggleTerminal={onToggleTerminal}
      onOpenCommandPalette={() => setCommandOpen(true)}
      onCollapse={() => onNavigatorVisibleChange(false)}
    />
  )

  const inspector = (
    <ParamPanel
      session={session}
      params={params}
      contextTokens={contextTokens}
      contextLimit={contextLimit}
      onParamChange={onParamChange}
      onCollapseToggle={() => onInspectorVisibleChange(false)}
    />
  )

  return (
    <main className="h-dvh min-h-0 w-full overflow-hidden bg-slate-950 text-slate-200 antialiased">
      <div className="hidden h-full min-h-0 md:flex">
        <AnimatePresence initial={false}>
          {navigatorVisible ? (
            <motion.div
              key="desktop-sidebar"
              className="h-full min-h-0 shrink-0 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 312, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={spring}
            >
              {sidebar}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {!navigatorVisible ? (
          <button
            type="button"
            className="absolute left-3 top-3 z-40 inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800/80 bg-slate-950/85 text-slate-400 shadow-xl backdrop-blur-md transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100"
            title="Open navigator"
            aria-label="Open navigator"
            onClick={() => onNavigatorVisibleChange(true)}
          >
            <PanelLeftOpen size={17} />
          </button>
        ) : null}

        <div className="min-h-0 min-w-0 flex-1">
          <Workspace
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
            onPromptChange={onPromptChange}
            onPromptKeyDown={onPromptKeyDown}
            onPromptSubmit={onPromptSubmit}
            onModeChange={onModeChange}
            onWorkdirChange={onWorkdirChange}
            onGoalModeChange={onGoalModeChange}
            onInterrupt={onInterrupt}
            onResume={onResume}
            onOpenMobileMenu={() => setMobileNavigatorOpen(true)}
            onOpenMobileInspector={() => setMobileInspectorOpen(true)}
          />
        </div>

        <AnimatePresence initial={false}>
          {inspectorVisible ? (
            <motion.div
              key="desktop-inspector"
              className="h-full min-h-0 shrink-0 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 308, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={spring}
            >
              {inspector}
            </motion.div>
          ) : (
            <motion.div
              key="desktop-inspector-collapsed"
              className="h-full min-h-0 shrink-0 overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 56, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={spring}
            >
              <ParamPanel
                collapsed
                session={session}
                params={params}
                contextTokens={contextTokens}
                contextLimit={contextLimit}
                onParamChange={onParamChange}
                onCollapseToggle={() => onInspectorVisibleChange(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="h-full min-h-0 md:hidden">
        <Workspace
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
          onPromptChange={onPromptChange}
          onPromptKeyDown={onPromptKeyDown}
          onPromptSubmit={onPromptSubmit}
          onModeChange={onModeChange}
          onWorkdirChange={onWorkdirChange}
          onGoalModeChange={onGoalModeChange}
          onInterrupt={onInterrupt}
          onResume={onResume}
          onOpenMobileMenu={() => setMobileNavigatorOpen(true)}
          onOpenMobileInspector={() => setMobileInspectorOpen(true)}
        />
      </div>

      <AnimatePresence>
        {mobileNavigatorOpen ? (
          <motion.div
            className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onMouseDown={() => setMobileNavigatorOpen(false)}
          >
            <motion.div
              className="relative h-full w-[min(88vw,330px)] overflow-hidden border-r border-slate-800/80 bg-slate-950 shadow-2xl"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={spring}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-800/80 bg-slate-950/85 text-slate-400 shadow-xl backdrop-blur-md transition duration-150 ease-out hover:bg-slate-800/70 hover:text-slate-100"
                title="Close navigator"
                aria-label="Close navigator"
                onClick={() => setMobileNavigatorOpen(false)}
              >
                <X size={15} />
              </button>
              <Sidebar
                projects={projects}
                selectedProjectId={selectedProjectId}
                selectedSessionId={selectedSessionId}
                sessionQuery={sessionQuery}
                terminalVisible={terminalVisible}
                onProjectChange={onProjectChange}
                onSessionQueryChange={onSessionQueryChange}
                onSelectSession={(nextSession) => {
                  onSelectSession(nextSession)
                  setMobileNavigatorOpen(false)
                }}
                onCreateSession={() => {
                  onCreateSession()
                  setMobileNavigatorOpen(false)
                }}
                onToggleTerminal={onToggleTerminal}
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
            className="fixed inset-0 z-[95] flex items-end bg-black/55 backdrop-blur-sm md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={spring}
            onMouseDown={() => setMobileInspectorOpen(false)}
          >
            <motion.div
              className="max-h-[86dvh] w-full overflow-hidden rounded-t-xl border-t border-slate-800/80 bg-slate-950 shadow-2xl"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={spring}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <ParamPanel
                session={session}
                params={params}
                contextTokens={contextTokens}
                contextLimit={contextLimit}
                onParamChange={onParamChange}
                onCollapseToggle={() => setMobileInspectorOpen(false)}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />
    </main>
  )
})
