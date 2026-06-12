import type {
  ControlThread,
  DashboardState,
  Project,
  RuntimeStatus,
  Task,
  ThreadDetail,
  ThreadItem,
  Turn,
  XyzEvent
} from "../server/domain.js";

export type ClientProjection = {
  state: DashboardState;
  detail: ThreadDetail | null;
};

export type ProjectionResult = ClientProjection & {
  handled: boolean;
  needsRefresh: boolean;
};

export const incrementalEventNames = [
  "project.upserted",
  "task.created",
  "item.created",
  "item.updated",
  "item.delta",
  "turn.started",
  "turn.status",
  "turn.steered",
  "turn.interrupt.requested",
  "thread.started",
  "thread.resumed",
  "thread.status",
  "thread.runtime_lost",
  "thread.continued",
  "thread.forked",
  "thread.renamed",
  "thread.goal.updated",
  "thread.goal.cleared",
  "thread.token_usage",
  "adapter.raw"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function payloadRecord(event: XyzEvent) {
  return isRecord(event.payload) ? event.payload : {};
}

function payloadValue<T>(event: XyzEvent, key: string) {
  const value = payloadRecord(event)[key];
  return isRecord(value) ? (value as T) : null;
}

function upsertById<T extends { id: string }>(items: T[], item: T, options: { prepend?: boolean } = {}) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) {
    return options.prepend ? [item, ...items] : [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function runtimeStatusFromTurnStatus(status: RuntimeStatus): RuntimeStatus {
  return status === "completed" ? "idle" : status;
}

function taskStatusFromRuntime(status: RuntimeStatus): Task["status"] {
  if (status === "completed" || status === "idle") {
    return "completed";
  }
  if (status === "failed" || status === "stale") {
    return "failed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return "running";
}

function withThread(projection: ClientProjection, thread: ControlThread): ClientProjection {
  return {
    state: {
      ...projection.state,
      threads: upsertById(projection.state.threads, thread, { prepend: true })
    },
    detail: projection.detail?.id === thread.id ? { ...projection.detail, ...thread } : projection.detail
  };
}

function withThreadFields(
  projection: ClientProjection,
  threadId: string,
  updates: Partial<ControlThread>
): ClientProjection {
  return {
    state: {
      ...projection.state,
      threads: projection.state.threads.map((thread) => (thread.id === threadId ? { ...thread, ...updates } : thread))
    },
    detail: projection.detail?.id === threadId ? { ...projection.detail, ...updates } : projection.detail
  };
}

function withTurn(projection: ClientProjection, turn: Turn): ClientProjection {
  if (projection.detail?.id !== turn.threadId) {
    return projection;
  }
  return {
    ...projection,
    detail: {
      ...projection.detail,
      turns: upsertById(projection.detail.turns, turn)
    }
  };
}

function withTurnFields(
  projection: ClientProjection,
  threadId: string,
  turnId: string,
  updates: Partial<Turn>
): ClientProjection {
  if (projection.detail?.id !== threadId) {
    return projection;
  }
  return {
    ...projection,
    detail: {
      ...projection.detail,
      turns: projection.detail.turns.map((turn) => (turn.id === turnId ? { ...turn, ...updates } : turn))
    }
  };
}

function withThreadItem(projection: ClientProjection, item: ThreadItem): ClientProjection {
  if (projection.detail?.id !== item.threadId) {
    return projection;
  }
  return {
    ...projection,
    detail: {
      ...projection.detail,
      items: upsertById(projection.detail.items, item)
    }
  };
}

function result(projection: ClientProjection, handled: boolean, event: XyzEvent): ProjectionResult {
  return {
    ...projection,
    handled,
    needsRefresh: event.type === "thread.started" || event.type === "thread.continued"
  };
}

export function applyEventProjection(projection: ClientProjection, event: XyzEvent): ProjectionResult {
  const thread = payloadValue<ControlThread>(event, "thread");
  if (
    thread &&
    [
      "thread.started",
      "thread.resumed",
      "thread.runtime_lost",
      "thread.continued",
      "thread.forked",
      "thread.renamed",
      "thread.goal.updated",
      "thread.goal.cleared",
      "thread.token_usage"
    ].includes(event.type)
  ) {
    return result(withThread(projection, thread), true, event);
  }

  if (event.type === "project.upserted") {
    const project = payloadValue<Project>(event, "project");
    if (!project) {
      return result(projection, false, event);
    }
    return result(
      {
        ...projection,
        state: {
          ...projection.state,
          projects: upsertById(projection.state.projects, project)
        }
      },
      true,
      event
    );
  }

  if (event.type === "task.created") {
    const task = payloadValue<Task>(event, "task");
    if (!task) {
      return result(projection, false, event);
    }
    return result(
      {
        ...projection,
        state: {
          ...projection.state,
          tasks: upsertById(projection.state.tasks, task, { prepend: true })
        }
      },
      true,
      event
    );
  }

  if (event.type === "turn.started") {
    const turn = payloadValue<Turn>(event, "turn");
    if (!turn) {
      return result(projection, false, event);
    }
    const updates: Partial<ControlThread> = {
      status: "running",
      activeTurnId: turn.id,
      updatedAt: turn.startedAt
    };
    if (turn.prompt) {
      updates.preview = turn.prompt;
    }
    const next = withThreadFields(withTurn(projection, turn), turn.threadId, updates);
    return result(
      {
        ...next,
        state: {
          ...next.state,
          tasks: next.state.tasks.map((task) =>
            task.threadId === turn.threadId ? { ...task, status: "running", updatedAt: turn.startedAt } : task
          )
        }
      },
      true,
      event
    );
  }

  if (event.type === "turn.status") {
    const status = payloadRecord(event).status as RuntimeStatus | undefined;
    if (!event.threadId || !event.turnId || !status) {
      return result(projection, false, event);
    }
    const completedAt = status === "running" ? null : event.createdAt;
    const next = withThreadFields(withTurnFields(projection, event.threadId, event.turnId, { status, completedAt }), event.threadId, {
      status: runtimeStatusFromTurnStatus(status),
      activeTurnId: status === "running" ? event.turnId : null,
      updatedAt: event.createdAt
    });
    return result(
      {
        ...next,
        state: {
          ...next.state,
          tasks: next.state.tasks.map((task) =>
            task.threadId === event.threadId
              ? { ...task, status: taskStatusFromRuntime(status), updatedAt: event.createdAt }
              : task
          )
        }
      },
      true,
      event
    );
  }

  if (event.type === "thread.status") {
    const status = payloadRecord(event).status as RuntimeStatus | undefined;
    if (!event.threadId || !status) {
      return result(projection, false, event);
    }
    return result(
      withThreadFields(projection, event.threadId, {
        status,
        updatedAt: event.createdAt
      }),
      true,
      event
    );
  }

  if (event.type === "item.created" || event.type === "item.updated" || event.type === "item.delta") {
    const item = payloadValue<ThreadItem>(event, "item");
    if (!item) {
      return result(projection, false, event);
    }
    return result(withThreadItem(projection, item), true, event);
  }

  return result(
    projection,
    event.type === "turn.steered" || event.type === "turn.interrupt.requested" || event.type === "adapter.raw",
    event
  );
}

export function applyEventProjectionBatch(projection: ClientProjection, events: XyzEvent[]): ProjectionResult {
  let nextProjection = projection;
  let handled = true;
  let needsRefresh = false;

  for (const event of events) {
    const next = applyEventProjection(nextProjection, event);
    nextProjection = {
      state: next.state,
      detail: next.detail
    };
    handled = handled && next.handled;
    needsRefresh = needsRefresh || next.needsRefresh;
  }

  return {
    ...nextProjection,
    handled,
    needsRefresh
  };
}
