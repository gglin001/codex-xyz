import type {
	RuntimeEvent,
	RuntimeGoalSnapshot,
	RuntimeThreadSnapshot,
	RuntimeTurnSnapshot,
} from "./codex/runtimePort.js";
import type {
	ControlThread,
	CozEvent,
	GoalStatus,
	ThreadItem,
	ThreadTagScore,
	Turn,
	TurnStatus,
} from "./domain.js";
import { nowIso, threadRuntimeStatusFromTurnStatus } from "./domain.js";
import type { EventBus } from "./eventBus.js";
import type { Store } from "./store.js";

function goalStatusFromRuntime(
	goal: RuntimeGoalSnapshot | null,
): GoalStatus | null {
	return goal ? goal.status : null;
}

function compactStoredPayload(type: string, payload: Record<string, unknown>) {
	if (type !== "item.created" && type !== "item.updated") {
		return payload;
	}
	const item = payload.item;
	if (!item || typeof item !== "object") {
		return payload;
	}
	const stored = item as ThreadItem;
	return {
		itemRef: {
			id: stored.id,
			threadId: stored.threadId,
			turnId: stored.turnId,
			type: stored.type,
			textLength: stored.text.length,
			createdAt: stored.createdAt,
		},
	};
}

export type CreateThreadProjectionInput = {
	runtimeThread: RuntimeThreadSnapshot;
	name: string;
	forkedFromId?: string | null;
	goalObjective: string | null;
	goalStatus: GoalStatus | null;
	goalTokenBudget?: number | null;
	preview?: string;
	tokensUsed: number;
};

type CreateThreadEventInput = {
	type: "thread.started" | "thread.forked";
	payload?: Record<string, unknown>;
};

export class ThreadProjection {
	private deferredEvents: CozEvent[] | null = null;

	constructor(
		private readonly store: Store,
		private readonly events: EventBus,
	) {}

	applyRuntimeEvent(event: RuntimeEvent) {
		return this.runInTransaction(() => {
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
					createdAt: nowIso(),
				};
				const stored = this.store.upsertItem(item) ?? item;
				this.publish(event.type, event.threadId, event.turnId, {
					item: stored,
				});
				return;
			}

			if (event.type === "item.delta") {
				const createdAt = nowIso();
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
						createdAt,
					});
				}
				this.publishTransient("item.delta", event.threadId, event.turnId, {
					itemId: event.itemId,
					delta: event.delta,
					itemType: item.type,
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
					durationMs: event.durationMs ?? null,
				});
				this.store.updateThread(event.threadId, {
					status: threadRuntimeStatusFromTurnStatus(event.status),
					activeTurnId: event.status === "in_progress" ? event.turnId : null,
					lastTurnStatus: event.status,
				});
				this.publish("turn.status", event.threadId, event.turnId, {
					status: event.status,
				});
				return;
			}

			if (event.type === "turn.started") {
				const thread = this.store.getThread(event.threadId);
				if (!thread) {
					return;
				}
				this.recordTurn(thread, event.prompt ?? "", {
					id: event.turnId,
					status: "in_progress",
				});
				return;
			}

			if (event.type === "thread.status") {
				if (!this.store.getThread(event.threadId)) {
					return;
				}
				const updates: Partial<
					Pick<ControlThread, "status" | "activeTurnId" | "lastTurnStatus">
				> = {
					status: event.status,
				};
				if (event.status !== "active") {
					const activeTurnStatus = this.interruptInProgressActiveTurn(
						event.threadId,
					);
					updates.activeTurnId = null;
					if (activeTurnStatus) {
						updates.lastTurnStatus = activeTurnStatus;
					}
				}
				const thread = this.store.updateThread(event.threadId, updates);
				this.publish("thread.status", event.threadId, null, {
					status: event.status,
					thread,
				});
				return;
			}

			if (event.type === "thread.goal") {
				if (!this.store.getThread(event.threadId)) {
					return;
				}
				this.updateGoal(event.threadId, event.goal, event.turnId);
				return;
			}

			if (event.type === "thread.name.updated") {
				if (!this.store.getThread(event.threadId)) {
					return;
				}
				const name = event.name?.trim();
				if (name) {
					const thread = this.store.updateThread(event.threadId, { name });
					this.publish("thread.name.updated", event.threadId, null, {
						name,
						thread,
					});
				}
				return;
			}

			if (event.type === "thread.token_usage") {
				const thread = this.store.updateThread(event.threadId, {
					tokensUsed: event.usage.totalTokens,
				});
				this.publish("thread.token_usage", event.threadId, event.turnId, {
					usage: event.usage,
					thread,
				});
				return;
			}

			if (event.type === "thread.archived") {
				this.confirmThreadLifecycle(event.threadId, "archive");
				return;
			}

			if (event.type === "thread.unarchived") {
				this.confirmThreadLifecycle(event.threadId, "unarchive");
				return;
			}

			if (event.type === "thread.deleted") {
				const thread = this.store.markThreadDeleted(event.threadId);
				if (thread) {
					this.publish("thread.deleted", event.threadId, null, { thread });
				}
				return;
			}

			if (event.type === "raw") {
				return;
			}
		});
	}

	publish(
		type: string,
		threadId: string | null,
		turnId: string | null,
		payload: Record<string, unknown>,
	): CozEvent {
		const storedPayload = compactStoredPayload(type, payload);
		const event = this.store.appendEvent({
			type,
			threadId,
			turnId,
			payload: storedPayload,
			createdAt: nowIso(),
		});
		const liveEvent = storedPayload === payload ? event : { ...event, payload };
		this.queueEvent(liveEvent);
		return liveEvent;
	}

	private publishTransient(
		type: string,
		threadId: string | null,
		turnId: string | null,
		payload: Record<string, unknown>,
	): CozEvent {
		const event = {
			type,
			threadId,
			turnId,
			payload,
			createdAt: nowIso(),
		} satisfies CozEvent;
		this.queueEvent(event);
		return event;
	}

	updateGoal(
		threadId: string,
		goal: RuntimeGoalSnapshot | null,
		turnId: string | null,
		options: { clearedStatus?: GoalStatus | null } = {},
	) {
		return this.runInTransaction(() => {
			const existing = this.store.getThread(threadId);
			const thread = this.store.updateThread(threadId, {
				goalObjective: goal?.objective ?? null,
				goalStatus: goal
					? goalStatusFromRuntime(goal)
					: (options.clearedStatus ?? null),
				goalTokenBudget: goal?.tokenBudget ?? null,
				tokensUsed: goal?.tokensUsed ?? existing?.tokensUsed ?? 0,
			});
			this.publish(
				goal ? "thread.goal.updated" : "thread.goal.cleared",
				threadId,
				turnId,
				{ goal, thread },
			);
			return thread;
		});
	}

	createThread(
		input: CreateThreadProjectionInput,
		eventInput?: CreateThreadEventInput,
	) {
		return this.runInTransaction(() => {
			const now = input.runtimeThread.updatedAt ?? nowIso();
			const status = input.runtimeThread.status;
			const thread: ControlThread = {
				id: input.runtimeThread.id,
				sessionId: input.runtimeThread.sessionId,
				forkedFromId: input.forkedFromId ?? input.runtimeThread.forkedFromId,
				name: input.runtimeThread.name?.trim() || input.name,
				preview: input.runtimeThread.preview || input.preview || input.name,
				cwd: input.runtimeThread.cwd,
				model: input.runtimeThread.model,
				status,
				activeTurnId:
					status === "active"
						? (input.runtimeThread.activeTurnId ?? null)
						: null,
				lastTurnStatus: status === "active" ? "in_progress" : null,
				goalObjective: input.goalObjective,
				goalStatus: input.goalStatus,
				goalTokenBudget: input.goalTokenBudget ?? null,
				tokensUsed: input.tokensUsed,
				tagScore: null,
				lifecycleState: "active",
				desiredArchived: false,
				remoteArchived: false,
				remoteObservedAt: now,
				remoteUpdatedAt: input.runtimeThread.updatedAt ?? null,
				localUpdatedAt: now,
				runtimeSeenAt: now,
				runtimeEpoch: 0,
				syncGeneration: 0,
				stateRevision: 0,
				lastOperationError: null,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			this.store.createThread(thread);
			if (eventInput) {
				this.publish(eventInput.type, thread.id, null, {
					thread,
					...(eventInput.payload ?? {}),
				});
			}
			return thread;
		});
	}

	updateThreadTagScore(threadId: string, tagScore: ThreadTagScore | null) {
		return this.runInTransaction(() => {
			const existing = this.store.getThread(threadId);
			if (!existing) {
				throw new Error(`Thread ${threadId} does not exist`);
			}
			if (existing.tagScore === tagScore) {
				return existing;
			}
			const thread = this.store.updateThreadTagScore(threadId, tagScore);
			this.publish("thread.tag.updated", threadId, null, {
				tagScore,
				thread,
			});
			return thread;
		});
	}

	confirmThreadLifecycle(threadId: string, kind: "archive" | "unarchive") {
		return this.runInTransaction(() => {
			const existing = this.store.getThread(threadId);
			if (!existing) return null;
			const archived = kind === "archive";
			const alreadyConfirmed =
				existing.remoteArchived === archived &&
				existing.lifecycleState === (archived ? "archived" : "active");
			const thread = this.store.confirmThreadOperation(threadId, kind);
			if (alreadyConfirmed) return thread;
			this.publish(
				kind === "archive" ? "thread.archived" : "thread.unarchived",
				threadId,
				null,
				{ thread },
			);
			return thread;
		});
	}

	recordTurn(
		thread: ControlThread,
		prompt: string,
		runtimeTurn: RuntimeTurnSnapshot,
	) {
		return this.runInTransaction(() => {
			const existing = this.store.getTurn(runtimeTurn.id);
			if (existing) {
				const current =
					!existing.prompt && prompt
						? (this.store.updateTurn(existing.id, { prompt }) ?? existing)
						: existing;
				this.store.updateThread(thread.id, {
					status: threadRuntimeStatusFromTurnStatus(current.status),
					activeTurnId: current.status === "in_progress" ? current.id : null,
					lastTurnStatus: current.status,
					preview: current.prompt || prompt || thread.preview,
				});
				return current;
			}

			const now = nowIso();
			const turnStatus = runtimeTurn.status;
			const turn: Turn = {
				id: runtimeTurn.id,
				threadId: thread.id,
				status: turnStatus,
				prompt,
				startedAt: now,
				completedAt: turnStatus === "in_progress" ? null : now,
				durationMs: null,
			};
			this.store.createTurn(turn);
			this.store.updateThread(thread.id, {
				status: threadRuntimeStatusFromTurnStatus(turnStatus),
				activeTurnId: turnStatus === "in_progress" ? turn.id : null,
				lastTurnStatus: turnStatus,
				preview: prompt || thread.preview,
			});
			this.publish("turn.started", thread.id, turn.id, { turn });
			return turn;
		});
	}

	applyRuntimeThreadSnapshot(
		thread: ControlThread,
		runtimeThread: RuntimeThreadSnapshot,
	) {
		return this.runInTransaction(() => {
			const runtimeStatus = runtimeThread.status;
			const nextActiveTurnId =
				runtimeStatus === "active"
					? (runtimeThread.activeTurnId ?? null)
					: null;
			if (nextActiveTurnId) {
				this.ensureTurnForEvent(thread.id, nextActiveTurnId);
			}
			const updates: Partial<
				Pick<
					ControlThread,
					"status" | "activeTurnId" | "lastTurnStatus" | "preview"
				>
			> = {
				status: runtimeStatus,
				activeTurnId: nextActiveTurnId,
				preview: runtimeThread.preview || thread.preview,
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
				(updates.lastTurnStatus !== undefined &&
					thread.lastTurnStatus !== updates.lastTurnStatus) ||
				thread.preview !== updates.preview;
			const updated = fieldsChanged
				? this.store.updateThread(
						thread.id,
						updates,
						runtimeThread.updatedAt
							? { updatedAt: runtimeThread.updatedAt }
							: { preserveUpdatedAt: true },
					)
				: thread;
			if (fieldsChanged) {
				this.publish("thread.status", thread.id, null, {
					status: runtimeStatus,
					thread: updated,
				});
			}

			return {
				thread: updated,
				updated: fieldsChanged,
			};
		});
	}

	clearLostActiveTurn(thread: ControlThread) {
		return this.runInTransaction(() => {
			const activeTurnStatus = this.interruptInProgressActiveTurn(thread.id);
			const updated = this.store.updateThread(thread.id, {
				status: "idle",
				activeTurnId: null,
				lastTurnStatus: activeTurnStatus ?? thread.lastTurnStatus,
			});
			this.publish("thread.status", thread.id, null, {
				status: "idle",
				thread: updated,
			});
			return updated ?? thread;
		});
	}

	markRuntimeThreadLost(thread: ControlThread) {
		return this.runInTransaction(() => {
			const activeTurnStatus = this.interruptInProgressActiveTurn(thread.id);
			const updated = this.store.updateThread(thread.id, {
				status: "not_loaded",
				activeTurnId: null,
				lastTurnStatus: activeTurnStatus ?? thread.lastTurnStatus,
			});
			this.publish("thread.runtime_lost", thread.id, null, { thread: updated });
		});
	}

	private queueEvent(event: CozEvent) {
		if (this.deferredEvents) {
			this.deferredEvents.push(event);
			return;
		}
		this.events.publish(event);
	}

	private runInTransaction<T>(body: () => T): T {
		if (this.deferredEvents) {
			return this.store.transaction(body);
		}
		const deferredEvents: CozEvent[] = [];
		this.deferredEvents = deferredEvents;
		try {
			const result = this.store.transaction(body);
			this.deferredEvents = null;
			for (const event of deferredEvents) {
				this.events.publish(event);
			}
			return result;
		} catch (error) {
			this.deferredEvents = null;
			throw error;
		}
	}

	private interruptInProgressActiveTurn(threadId: string): TurnStatus | null {
		const thread = this.store.getThread(threadId);
		const activeTurn = thread?.activeTurnId
			? this.store.getTurn(thread.activeTurnId)
			: null;
		if (!activeTurn) {
			return null;
		}
		if (activeTurn.status !== "in_progress") {
			return activeTurn.status;
		}
		this.store.updateTurn(activeTurn.id, {
			status: "interrupted",
			completedAt: nowIso(),
			durationMs: null,
		});
		return "interrupted";
	}

	private ensureTurnForEvent(
		threadId: string,
		turnId: string | null,
		prompt = "",
	) {
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
			durationMs: null,
		};
		this.store.createTurn(turn);
		this.store.updateThread(threadId, {
			status: "active",
			activeTurnId: turnId,
			lastTurnStatus: "in_progress",
			preview: prompt || thread.preview,
		});
		this.publish("turn.started", threadId, turnId, { turn });
		return true;
	}
}
