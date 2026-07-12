import { describe, expect, it } from "vitest";
import {
	getComposerThreadActionState,
	showsUnarchiveAction,
} from "../src/client/composerThreadActions.js";
import type { ControlThread } from "../src/server/domain.js";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		parentThreadId: null,
		sourceKind: "app_server",
		agentNickname: null,
		agentRole: null,
		name: "Thread",
		preview: "Preview",
		cwd: "/repo",
		model: null,
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: "completed",
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		contextWindow: null,
		tagScore: null,
		lifecycleState: "active",
		desiredArchived: false,
		remoteArchived: false,
		remoteObservedAt: null,
		remoteUpdatedAt: null,
		localUpdatedAt: "2026-07-11T00:00:00.000Z",
		runtimeSeenAt: null,
		runtimeEpoch: 0,
		syncGeneration: 0,
		stateRevision: 0,
		lastOperationError: null,
		archivedAt: null,
		createdAt: "2026-07-11T00:00:00.000Z",
		updatedAt: "2026-07-11T00:00:00.000Z",
		...overrides,
	};
}

function state(value: ControlThread | null, busy = false) {
	return getComposerThreadActionState({
		thread: value,
		threadId: value?.id ?? null,
		pendingSubmission: false,
		busy,
	});
}

describe("Composer thread action state", () => {
	it("enables goal and idle-only actions for an idle thread", () => {
		const actions = state(thread());
		expect(actions.goal).toBeNull();
		expect(actions.compact).toBeNull();
		expect(actions.interrupt).toBe("No active turn is running");
		expect(actions.resume).toBe("Thread is already loaded");
	});

	it("enables interrupt but blocks idle-only actions during an active turn", () => {
		const actions = state(thread({ status: "active", activeTurnId: "turn-1" }));
		expect(actions.goal).toBe("Wait for the active turn to finish");
		expect(actions.compact).toBe("Wait for the active turn to finish");
		expect(actions.interrupt).toBeNull();
		expect(actions.fork).toBeNull();
	});

	it("allows resume and goal for a persisted unloaded thread", () => {
		const actions = state(thread({ status: "not_loaded" }));
		expect(actions.goal).toBeNull();
		expect(actions.resume).toBeNull();
	});

	it("keeps child subagent input controlled by its parent", () => {
		const actions = state(
			thread({
				parentThreadId: "thread-parent",
				sourceKind: "subagent",
			}),
		);
		expect(actions.goal).toBe("Control this sub-agent from its parent thread");
	});

	it("exposes goal lifecycle actions only when a goal exists", () => {
		expect(state(thread()).goalStatus).toBe("This thread has no goal");
		expect(
			state(thread({ goalObjective: "Ship it", goalStatus: "paused" }))
				.goalStatus,
		).toBeNull();
	});

	it("keeps lifecycle operations pointed in their pending direction", () => {
		expect(
			showsUnarchiveAction(thread({ lifecycleState: "archive_pending" })),
		).toBe(false);
		expect(
			showsUnarchiveAction(thread({ lifecycleState: "unarchive_pending" })),
		).toBe(true);
	});

	it("blocks all runtime actions while another action is running", () => {
		const actions = state(thread(), true);
		expect(actions.goal).toBe("Another action is running");
		expect(actions.fork).toBe("Another action is running");
		expect(actions.archive).toBe("Another action is running");
	});
});
