import { sessionDisplayStatus, type ControlThread } from "../../server/domain.js"
import type { DateBucket, ProjectAccent, WorkbenchProject, WorkbenchSession } from "./workbenchTypes.js"

const accentCycle: ProjectAccent[] = ["emerald", "violet", "sky", "slate"]

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

function basename(path: string) {
  const normalized = path.replace(/\/+$/, "")
  const parts = normalized.split("/")
  return parts.at(-1) || normalized || "Workspace"
}

function initialsForName(name: string) {
  const words = name
    .replace(/[-_.]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) {
    return "CX"
  }
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(2, "X")
    .slice(0, 2)
}

function stableIndex(value: string, modulo: number) {
  if (modulo <= 0) {
    return 0
  }
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index) * (index + 1)) % modulo
  }
  return hash
}

function sessionFromThread(thread: ControlThread): WorkbenchSession {
  return {
    id: thread.id,
    threadId: thread.id,
    sessionId: thread.sessionId,
    forkedFromId: thread.forkedFromId,
    title: thread.title || "Untitled Codex session",
    preview: thread.preview || "No transcript preview yet.",
    cwd: thread.cwd || "Unknown workdir",
    model: thread.model,
    status: sessionDisplayStatus(thread),
    runtimeStatus: thread.status,
    activeTurnId: thread.activeTurnId,
    lastTurnStatus: thread.lastTurnStatus,
    goalObjective: thread.goalObjective,
    goalStatus: thread.goalStatus,
    goalTokenBudget: thread.goalTokenBudget,
    tokensUsed: thread.tokensUsed,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    dateBucket: bucketForDate(thread.updatedAt),
    thread
  }
}

function sortSessions(sessions: WorkbenchSession[]) {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function projectFromPath(path: string, sessions: WorkbenchSession[]): WorkbenchProject {
  const name = basename(path)
  const accent = accentCycle[stableIndex(path, accentCycle.length)] ?? "slate"
  const sortedSessions = sortSessions(sessions)
  return {
    id: path,
    name,
    path,
    initials: initialsForName(name),
    accent,
    sessions: sortedSessions,
    totalSessions: sortedSessions.length,
    runningSessions: sortedSessions.filter((session) => session.runtimeStatus === "active").length,
    tokenTotal: sortedSessions.reduce((total, session) => total + session.tokensUsed, 0)
  }
}

export function emptyWorkbenchProject(defaultCwd: string): WorkbenchProject {
  const path = defaultCwd || "No workspace"
  return projectFromPath(path, [])
}

export function buildWorkbenchProjects(threads: ControlThread[], defaultCwd: string): WorkbenchProject[] {
  const grouped = new Map<string, WorkbenchSession[]>()

  for (const thread of threads) {
    const session = sessionFromThread(thread)
    const key = session.cwd
    const sessions = grouped.get(key)
    if (sessions) {
      sessions.push(session)
    } else {
      grouped.set(key, [session])
    }
  }

  if (grouped.size === 0) {
    return [emptyWorkbenchProject(defaultCwd)]
  }

  return [...grouped.entries()]
    .map(([path, sessions]) => projectFromPath(path, sessions))
    .sort((a, b) => {
      const aLatest = a.sessions[0]?.updatedAt ?? ""
      const bLatest = b.sessions[0]?.updatedAt ?? ""
      return bLatest.localeCompare(aLatest) || a.name.localeCompare(b.name)
    })
}

export function findProjectForThread(projects: WorkbenchProject[], threadId: string | null) {
  if (!threadId) {
    return null
  }
  return projects.find((project) => project.sessions.some((session) => session.threadId === threadId)) ?? null
}
