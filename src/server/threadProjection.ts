import type {
  ControlThread,
  GoalStatus,
  ThreadRuntimeStatus,
  ThreadItem,
  Turn,
  TurnStatus,
  XyzEvent
} from "./domain.js";
import { nowIso, threadRuntimeStatusFromTurnStatus } from "./domain.js";
import type { EventBus } from "./eventBus.js";
import type { Store } from "./store.js";
import type { AdapterEvent, AdapterGoal, AdapterThread, AdapterTurn } from "./codex/adapter.js";

function goalStatusFromAdapter(goal: AdapterGoal | null): GoalStatus | null {
  return goal ? goal.status : null;
}

export type CreateThreadProjectionInput = {
  adapterThread: AdapterThread;
  title: string;
  forkedFromId?: string | null;
  goalObjective: string | null;
  goalStatus: GoalStatus | null;
  goalTokenBudget?: number | null;
  preview?: string;
  tokensUsed: number;
};

export class ThreadProjection {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus
  ) {}

  applyAdapterEvent(event: AdapterEvent) {
    if (event.type === "item.created" || event.type === "item.updated") {
      if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
        return;
      }
      const item: ThreadItem = {
        id: event.itemId,
        threadId: event.threadId,
        turnId: event.turnId,
        type: event.itemType,
        text: event.text,
        data: event.data ?? {},
        createdAt: nowIso()
      };
      const stored = this.store.upsertItem(item) ?? item;
      this.publish(event.type, event.threadId, event.turnId, { item: stored });
      return;
    }

    if (event.type === "item.delta") {
      let item = this.store.appendItemText(event.itemId, event.delta);
      if (!item) {
        if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
          return;
        }
        item = this.store.createItem({
          id: event.itemId,
          threadId: event.threadId,
          turnId: event.turnId,
          type: event.itemType ?? "agent",
          text: event.delta,
          data: { synthesized: true },
          createdAt: nowIso()
        });
      }
      this.publish("item.delta", event.threadId, event.turnId, {
        itemId: event.itemId,
        delta: event.delta,
        item
      });
      return;
    }

    if (event.type === "turn.status") {
      if (!this.ensureTurnForEvent(event.threadId, event.turnId)) {
        return;
      }
      const completedAt = event.status === "in_progress" ? null : nowIso();
      this.store.updateTurn(event.turnId, {
        status: event.status,
        completedAt,
        durationMs: event.durationMs ?? null
      });
      this.store.updateThread(event.threadId, {
        status: threadRuntimeStatusFromTurnStatus(event.status),
        activeTurnId: event.status === "in_progress" ? event.turnId : null,
        lastTurnStatus: event.status
      });
      this.publish("turn.status", event.threadId, event.turnId, { status: event.status });
      return;
    }

    if (event.type === "turn.started") {
      const thread = this.store.getThread(event.threadId);
      if (!thread) {
        return;
      }
      this.recordTurn(thread, event.prompt ?? "", {
        id: event.turnId,
        status: "in_progress"
      });
      return;
    }

    if (event.type === "thread.status") {
      const updates: Partial<Pick<ControlThread, "status" | "activeTurnId" | "lastTurnStatus">> = {
        status: event.status
      };
      if (event.status !== "active") {
        const activeTurnStatus = this.interruptInProgressActiveTurn(event.threadId);
        updates.activeTurnId = null;
        if (activeTurnStatus) {
          updates.lastTurnStatus = activeTurnStatus;
        }
      }
      const thread = this.store.updateThread(event.threadId, updates);
      this.publish("thread.status", event.threadId, null, { status: event.status, thread });
      return;
    }

    if (event.type === "thread.goal") {
      this.updateGoal(event.threadId, event.goal, event.turnId);
      return;
    }

    if (event.type === "thread.renamed") {
      const title = event.title?.trim();
      if (title) {
        const thread = this.store.updateThread(event.threadId, { title });
        this.publish("thread.renamed", event.threadId, null, { title, thread });
      }
      return;
    }

    if (event.type === "thread.token_usage") {
      const thread = this.store.updateThread(event.threadId, {
        tokensUsed: event.usage.totalTokens
      });
      this.publish("thread.token_usage", event.threadId, event.turnId, {
        usage: event.usage,
        thread
      });
      return;
    }

    if (event.type === "raw") {
      this.publish("adapter.raw", event.threadId ?? null, event.turnId ?? null, {
        method: event.method,
        payload: event.payload
      });
    }
  }

  publish(type: string, threadId: string | null, turnId: string | null, payload: Record<string, unknown>): XyzEvent {
    const event = this.store.appendEvent({
      type,
      threadId,
      turnId,
      payload,
      createdAt: nowIso()
    });
    this.events.publish(event);
    return event;
  }

  updateGoal(
    threadId: string,
    goal: AdapterGoal | null,
    turnId: string | null,
    options: { clearedStatus?: GoalStatus | null } = {}
  ) {
    const existing = this.store.getThread(threadId);
    const thread = this.store.updateThread(threadId, {
      goalObjective: goal?.objective ?? null,
      goalStatus: goal ? goalStatusFromAdapter(goal) : (options.clearedStatus ?? null),
      goalTokenBudget: goal?.tokenBudget ?? null,
      tokensUsed: goal?.tokensUsed ?? existing?.tokensUsed ?? 0
    });
    this.publish(goal ? "thread.goal.updated" : "thread.goal.cleared", threadId, turnId, { goal, thread });
    return thread;
  }

  createThread(input: CreateThreadProjectionInput) {
    const now = input.adapterThread.updatedAt ?? nowIso();
    const status = input.adapterThread.status;
    const thread: ControlThread = {
      id: input.adapterThread.id,
      sessionId: input.adapterThread.sessionId,
      forkedFromId: input.forkedFromId ?? input.adapterThread.forkedFromId,
      title: input.title,
      preview: input.adapterThread.preview || input.preview || input.title,
      cwd: input.adapterThread.cwd,
      model: input.adapterThread.model,
      status,
      activeTurnId: status === "active" ? (input.adapterThread.activeTurnId ?? null) : null,
      lastTurnStatus: status === "active" ? "in_progress" : null,
      goalObjective: input.goalObjective,
      goalStatus: input.goalStatus,
      goalTokenBudget: input.goalTokenBudget ?? null,
      tokensUsed: input.tokensUsed,
      createdAt: now,
      updatedAt: now
    };
    this.store.createThread(thread);
    return thread;
  }

  recordTurn(thread: ControlThread, prompt: string, adapterTurn: AdapterTurn) {
    const existing = this.store.getTurn(adapterTurn.id);
    if (existing) {
      const current = !existing.prompt && prompt ? this.store.updateTurn(existing.id, { prompt }) ?? existing : existing;
      this.store.updateThread(thread.id, {
        status: threadRuntimeStatusFromTurnStatus(current.status),
        activeTurnId: current.status === "in_progress" ? current.id : null,
        lastTurnStatus: current.status,
        preview: current.prompt || prompt || thread.preview
      });
      return current;
    }

    const now = nowIso();
    const turnStatus = adapterTurn.status;
    const turn: Turn = {
      id: adapterTurn.id,
      threadId: thread.id,
      status: turnStatus,
      prompt,
      startedAt: now,
      completedAt: turnStatus === "in_progress" ? null : now,
      durationMs: null
    };
    this.store.createTurn(turn);
    this.store.updateThread(thread.id, {
      status: threadRuntimeStatusFromTurnStatus(turnStatus),
      activeTurnId: turnStatus === "in_progress" ? turn.id : null,
      lastTurnStatus: turnStatus,
      preview: prompt || thread.preview
    });
    this.publish("turn.started", thread.id, turn.id, { turn });
    return turn;
  }

  applyRuntimeThreadSnapshot(thread: ControlThread, adapterThread: AdapterThread) {
    const runtimeStatus = adapterThread.status;
    const nextActiveTurnId = runtimeStatus === "active" ? (adapterThread.activeTurnId ?? null) : null;
    if (nextActiveTurnId) {
      this.ensureTurnForEvent(thread.id, nextActiveTurnId);
    }
    const updates: Partial<Pick<ControlThread, "status" | "activeTurnId" | "lastTurnStatus" | "preview">> = {
      status: runtimeStatus,
      activeTurnId: nextActiveTurnId,
      preview: adapterThread.preview || thread.preview
    };
    if (runtimeStatus === "active") {
      updates.lastTurnStatus = "in_progress";
    }
    if (runtimeStatus !== "active") {
      const activeTurnStatus = this.interruptInProgressActiveTurn(thread.id);
      if (activeTurnStatus) {
        updates.lastTurnStatus = activeTurnStatus;
      }
    }
    const fieldsChanged =
      thread.status !== updates.status ||
      thread.activeTurnId !== updates.activeTurnId ||
      (updates.lastTurnStatus !== undefined && thread.lastTurnStatus !== updates.lastTurnStatus) ||
      thread.preview !== updates.preview;
    const updatedAtChanged = Boolean(adapterThread.updatedAt && adapterThread.updatedAt !== thread.updatedAt);
    const changed = fieldsChanged || updatedAtChanged;

    const updated = changed
      ? this.store.updateThread(
          thread.id,
          updates,
          adapterThread.updatedAt ? { updatedAt: adapterThread.updatedAt } : { preserveUpdatedAt: true }
        )
      : thread;
    if (fieldsChanged) {
      this.publish("thread.status", thread.id, null, { status: runtimeStatus, thread: updated });
    }

    return {
      thread: updated,
      updated: changed
    };
  }

  clearLostActiveTurn(thread: ControlThread) {
    const activeTurnStatus = this.interruptInProgressActiveTurn(thread.id);
    const updated = this.store.updateThread(thread.id, {
      status: "idle",
      activeTurnId: null,
      lastTurnStatus: activeTurnStatus ?? thread.lastTurnStatus
    });
    this.publish("thread.status", thread.id, null, { status: "idle", thread: updated });
    return updated ?? thread;
  }

  markRuntimeThreadLost(thread: ControlThread) {
    const activeTurnStatus = this.interruptInProgressActiveTurn(thread.id);
    const updated = this.store.updateThread(thread.id, {
      status: "not_loaded",
      activeTurnId: null,
      lastTurnStatus: activeTurnStatus ?? thread.lastTurnStatus
    });
    this.publish("thread.runtime_lost", thread.id, null, { thread: updated });
  }

  private interruptInProgressActiveTurn(threadId: string): TurnStatus | null {
    const thread = this.store.getThread(threadId);
    const activeTurn = thread?.activeTurnId ? this.store.getTurn(thread.activeTurnId) : null;
    if (!activeTurn) {
      return null;
    }
    if (activeTurn.status !== "in_progress") {
      return activeTurn.status;
    }
    this.store.updateTurn(activeTurn.id, {
      status: "interrupted",
      completedAt: nowIso(),
      durationMs: null
    });
    return "interrupted";
  }

  private ensureTurnForEvent(threadId: string, turnId: string | null, prompt = "") {
    const thread = this.store.getThread(threadId);
    if (!thread) {
      return false;
    }
    if (!turnId) {
      return true;
    }
    const existing = this.store.getTurn(turnId);
    if (existing) {
      return true;
    }
    const now = nowIso();
    const turn: Turn = {
      id: turnId,
      threadId,
      status: "in_progress",
      prompt,
      startedAt: now,
      completedAt: null,
      durationMs: null
    };
    this.store.createTurn(turn);
    this.store.updateThread(threadId, {
      status: "active",
      activeTurnId: turnId,
      lastTurnStatus: "in_progress",
      preview: prompt || thread.preview
    });
    this.publish("turn.started", threadId, turnId, { turn });
    return true;
  }
}
