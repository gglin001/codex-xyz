import type { ControlThread } from "../../server/domain.js"
import type { DateBucket, ProjectAccent, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

const projectSpecs: Array<{
  id: string
  name: string
  path: string
  initials: string
  accent: ProjectAccent
}> = [
  {
    id: "project-alpha",
    name: "Project Alpha",
    path: "~/repos/alpha-platform",
    initials: "PA",
    accent: "emerald"
  },
  {
    id: "project-beta",
    name: "Project Beta",
    path: "~/repos/beta-runtime",
    initials: "PB",
    accent: "violet"
  },
  {
    id: "project-gamma",
    name: "Project Gamma",
    path: "~/repos/gamma-labs",
    initials: "PG",
    accent: "sky"
  }
]

const fallbackSessions: WorkbenchSession[] = [
  {
    id: "mock-alpha-1",
    threadId: null,
    title: "Refactor streaming control plane",
    preview: "Split the app shell into a session manager, chat workspace, and runtime inspector.",
    cwd: "~/repos/alpha-platform",
    model: "codex",
    status: "running",
    tokensUsed: 38240,
    updatedAt: new Date().toISOString(),
    dateBucket: "Today",
    mock: true,
    thread: null
  },
  {
    id: "mock-alpha-2",
    threadId: null,
    title: "Tighten SQLite event projection tests",
    preview: "Add coverage for incremental turn status updates and resumed runtime events.",
    cwd: "~/repos/alpha-platform",
    model: "codex",
    status: "idle",
    tokensUsed: 18400,
    updatedAt: offsetDate(-1),
    dateBucket: "Yesterday",
    mock: true,
    thread: null
  },
  {
    id: "mock-beta-1",
    threadId: null,
    title: "Build terminal replay diagnostics",
    preview: "Inspect terminal output ordering and create a focused repro under debug_agent.",
    cwd: "~/repos/beta-runtime",
    model: "codex",
    status: "completed",
    tokensUsed: 64200,
    updatedAt: offsetDate(-2),
    dateBucket: "Older",
    mock: true,
    thread: null
  },
  {
    id: "mock-beta-2",
    threadId: null,
    title: "Prototype command palette routing",
    preview: "Wire project switching, session creation, and panel toggles behind keyboard actions.",
    cwd: "~/repos/beta-runtime",
    model: "codex",
    status: "idle",
    tokensUsed: 27100,
    updatedAt: offsetDate(0),
    dateBucket: "Today",
    mock: true,
    thread: null
  },
  {
    id: "mock-gamma-1",
    threadId: null,
    title: "Audit mobile inspector drawer",
    preview: "Verify narrow viewport behavior and bottom parameter sheet ergonomics.",
    cwd: "~/repos/gamma-labs",
    model: "codex",
    status: "stale",
    tokensUsed: 9600,
    updatedAt: offsetDate(-3),
    dateBucket: "Older",
    mock: true,
    thread: null
  }
]

function offsetDate(days: number) {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return value.toISOString()
}

function bucketForDate(value: string, now = new Date()): DateBucket {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Older"
  }

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  if (date >= startOfToday) {
    return "Today"
  }
  if (date >= startOfYesterday) {
    return "Yesterday"
  }
  return "Older"
}

function projectIndexForThread(thread: ControlThread) {
  const key = `${thread.cwd}:${thread.id}`
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash + key.charCodeAt(index) * (index + 1)) % projectSpecs.length
  }
  return hash
}

function sessionFromThread(thread: ControlThread): WorkbenchSession {
  return {
    id: thread.id,
    threadId: thread.id,
    title: thread.title || "Untitled session",
    preview: thread.preview || "No transcript preview yet.",
    cwd: thread.cwd || "Unknown workdir",
    model: thread.model,
    status: thread.status,
    tokensUsed: thread.tokensUsed,
    updatedAt: thread.updatedAt,
    dateBucket: bucketForDate(thread.updatedAt),
    mock: false,
    thread
  }
}

function sortSessions(sessions: WorkbenchSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function buildWorkbenchProjects(threads: ControlThread[]): WorkbenchProject[] {
  const projectSessions = new Map(projectSpecs.map((project) => [project.id, [] as WorkbenchSession[]]))

  if (threads.length === 0) {
    for (const session of fallbackSessions) {
      const project = projectSpecs.find((candidate) => candidate.path === session.cwd) ?? projectSpecs[0]
      projectSessions.get(project.id)?.push(session)
    }
  } else {
    for (const thread of threads) {
      const project = projectSpecs[projectIndexForThread(thread)]
      projectSessions.get(project.id)?.push(sessionFromThread(thread))
    }

    for (const project of projectSpecs) {
      const sessions = projectSessions.get(project.id)
      if (sessions && sessions.length === 0) {
        sessions.push(...fallbackSessions.filter((session) => session.cwd === project.path))
      }
    }
  }

  return projectSpecs.map((project) => {
    const sessions = sortSessions(projectSessions.get(project.id) ?? [])
    return {
      ...project,
      sessions,
      totalSessions: sessions.length,
      runningSessions: sessions.filter((session) => session.status === "running").length,
      tokenTotal: sessions.reduce((total, session) => total + session.tokensUsed, 0)
    }
  })
}

export function findProjectForThread(projects: WorkbenchProject[], threadId: string | null) {
  if (!threadId) {
    return null
  }
  return projects.find((project) => project.sessions.some((session) => session.threadId === threadId)) ?? null
}

export function findSession(projects: WorkbenchProject[], sessionId: string | null) {
  if (!sessionId) {
    return null
  }
  for (const project of projects) {
    const session = project.sessions.find((candidate) => candidate.id === sessionId || candidate.threadId === sessionId)
    if (session) {
      return session
    }
  }
  return null
}
