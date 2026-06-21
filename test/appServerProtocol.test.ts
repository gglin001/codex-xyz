import { describe, expect, it } from "vitest"
import { AdapterThreadNotFoundError } from "../src/server/codex/adapter.js"
import {
  normalizeGoal,
  normalizeThread,
  projectAppServerNotification,
  requestError,
  yoloApprovalResponse
} from "../src/server/codex/appServerProtocol.js"

describe("app-server protocol projection", () => {
  it("normalizes app-server thread ids, status, timestamps, and model fallback", () => {
    expect(
      normalizeThread(
        {
          id: "thread_00000000-0000-4000-8000-000000000001",
          sessionId: "urn:uuid:00000000-0000-4000-8000-000000000002",
          forkedFromId: "thread_00000000-0000-4000-8000-000000000003",
          preview: "Runtime preview",
          cwd: "/work/codex-xyz",
          status: { type: "active", turnId: "turn-1" },
          updatedAt: 1_700_000_000
        },
        "gpt-test"
      )
    ).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
      forkedFromId: "00000000-0000-4000-8000-000000000003",
      preview: "Runtime preview",
      cwd: "/work/codex-xyz",
      model: "gpt-test",
      status: "running",
      activeTurnId: "turn-1",
      updatedAt: "2023-11-14T22:13:20.000Z"
    })
  })

  it("maps app-server goal statuses onto local goal statuses", () => {
    expect(normalizeGoal({ objective: "Ship", status: "active", tokenBudget: 100, tokensUsed: 7 })).toMatchObject({
      objective: "Ship",
      status: "in_progress",
      tokenBudget: 100,
      tokensUsed: 7
    })
    expect(normalizeGoal({ status: "usageLimited" }).status).toBe("usage_limited")
    expect(normalizeGoal({ status: "budgetLimited" }).status).toBe("budget_limited")
    expect(normalizeGoal({ status: "blocked" }).status).toBe("blocked")
    expect(normalizeGoal({ status: "paused" }).status).toBe("paused")
    expect(normalizeGoal({ status: "complete" }).status).toBe("complete")
  })

  it("classifies missing rollout errors as thread-not-found runtime drift", () => {
    const error = requestError(
      {
        message: "no rollout found for thread id 019ee0dd-6f13-7043-995f-d88646e16316"
      },
      {
        threadId: "019ee0dd-6f13-7043-995f-d88646e16316"
      }
    )

    expect(error).toBeInstanceOf(AdapterThreadNotFoundError)
    expect((error as AdapterThreadNotFoundError).threadId).toBe("019ee0dd-6f13-7043-995f-d88646e16316")
  })

  it("projects streaming item notifications into adapter events", () => {
    expect(
      projectAppServerNotification("item/agentMessage/delta", {
        threadId: "thread_00000000-0000-4000-8000-000000000001",
        turnId: "turn-1",
        itemId: "item-agent",
        delta: "partial"
      })
    ).toEqual({
      type: "item.delta",
      threadId: "00000000-0000-4000-8000-000000000001",
      turnId: "turn-1",
      itemId: "item-agent",
      delta: "partial",
      itemType: "agent"
    })

    expect(
      projectAppServerNotification("item/completed", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "item-command",
          command: "pnpm test",
          cwd: "/work/codex-xyz",
          status: "completed",
          source: "agent",
          aggregatedOutput: "ok\n",
          exitCode: 0,
          durationMs: 12
        }
      })
    ).toMatchObject({
      type: "item.updated",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-command",
      itemType: "command",
      text: "$ pnpm test\nok\n[completed, exit 0]"
    })
  })

  it("projects turn, status, goal, and token notifications", () => {
    expect(
      projectAppServerNotification("turn/completed", {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          durationMs: 25
        }
      })
    ).toEqual({
      type: "turn.status",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      durationMs: 25
    })

    expect(
      projectAppServerNotification("thread/status/changed", {
        threadId: "thread-1",
        status: { type: "notLoaded" }
      })
    ).toEqual({
      type: "thread.status",
      threadId: "thread-1",
      status: "stale"
    })

    expect(
      projectAppServerNotification("thread/goal/updated", {
        threadId: "thread-1",
        turnId: "turn-1",
        goal: {
          objective: "Ship",
          status: "active",
          tokenBudget: null,
          tokensUsed: 42
        }
      })
    ).toMatchObject({
      type: "thread.goal",
      threadId: "thread-1",
      turnId: "turn-1",
      goal: {
        objective: "Ship",
        status: "in_progress",
        tokensUsed: 42
      }
    })

    expect(
      projectAppServerNotification("thread/tokenUsage/updated", {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 42,
            inputTokens: 20,
            cachedInputTokens: 4,
            outputTokens: 18,
            reasoningOutputTokens: 2
          },
          modelContextWindow: 128000
        }
      })
    ).toMatchObject({
      type: "thread.token_usage",
      threadId: "thread-1",
      turnId: "turn-1",
      usage: {
        totalTokens: 42,
        modelContextWindow: 128000
      }
    })
  })

  it("builds fixed yolo approval responses at the app-server boundary", () => {
    expect(yoloApprovalResponse("item/commandExecution/requestApproval", {})).toEqual({
      decision: "accept"
    })
    expect(
      yoloApprovalResponse("item/permissions/requestApproval", {
        permissions: {
          fileSystem: "danger-full-access"
        }
      })
    ).toEqual({
      permissions: {
        fileSystem: "danger-full-access"
      },
      scope: "session"
    })
  })
})
