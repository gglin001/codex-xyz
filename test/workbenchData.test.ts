import { describe, expect, it } from "vitest"
import { buildWorkbenchProjects, emptyWorkbenchProject, findProjectForThread } from "../src/client/components/workbenchData.js"
import type { ControlThread } from "../src/server/domain.js"

const createdAt = "2026-06-13T00:00:00.000Z"
const early = "2026-06-13T00:01:00.000Z"
const middle = "2026-06-13T00:02:00.000Z"
const late = "2026-06-13T00:03:00.000Z"

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    title: "Implement search",
    preview: "Add a session filter",
    cwd: "/work/codex-xyz",
    model: "gpt-test",
    status: "idle",
    activeTurnId: null,
    goalObjective: null,
    goalStatus: null,
    goalTokenBudget: null,
    tokensUsed: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

describe("workbench project data", () => {
  it("groups sessions by cwd and sorts projects and sessions by recency", () => {
    const projects = buildWorkbenchProjects(
      [
        thread({ id: "xyz-old", cwd: "/work/codex-xyz", updatedAt: early, tokensUsed: 5 }),
        thread({ id: "api-latest", cwd: "/work/api-server", updatedAt: late, tokensUsed: 10 }),
        thread({ id: "xyz-middle", cwd: "/work/codex-xyz", status: "running", updatedAt: middle, tokensUsed: 7 })
      ],
      "/work/codex-xyz"
    )

    expect(projects.map((project) => project.name)).toEqual(["api-server", "codex-xyz"])
    expect(projects.map((project) => project.path)).toEqual(["/work/api-server", "/work/codex-xyz"])
    expect(projects[1]?.sessions.map((session) => session.threadId)).toEqual(["xyz-middle", "xyz-old"])
    expect(projects[1]).toMatchObject({
      totalSessions: 2,
      runningSessions: 1,
      tokenTotal: 12
    })
  })

  it("creates a default project when no threads are loaded", () => {
    const projects = buildWorkbenchProjects([], "/work/codex-xyz")

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      id: "/work/codex-xyz",
      name: "codex-xyz",
      sessions: [],
      totalSessions: 0
    })
  })

  it("finds the project that owns a thread", () => {
    const projects = buildWorkbenchProjects(
      [
        thread({ id: "a", cwd: "/work/a" }),
        thread({ id: "b", cwd: "/work/b" })
      ],
      "/work/a"
    )

    expect(findProjectForThread(projects, "b")?.path).toBe("/work/b")
    expect(findProjectForThread(projects, "missing")).toBeNull()
    expect(findProjectForThread(projects, null)).toBeNull()
  })

  it("uses a stable fallback path for an empty default cwd", () => {
    expect(emptyWorkbenchProject("")).toMatchObject({
      id: "No workspace",
      name: "No workspace"
    })
  })
})
