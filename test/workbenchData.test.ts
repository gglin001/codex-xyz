import { describe, expect, it } from "vitest";
import {
	buildWorkbenchProjects,
	emptyWorkbenchProject,
	findProjectForThread,
} from "../src/client/components/workbenchData.js";
import type { ControlThread } from "../src/server/domain.js";

const createdAt = "2026-06-13T00:00:00.000Z";
const early = "2026-06-13T00:01:00.000Z";
const middle = "2026-06-13T00:02:00.000Z";
const late = "2026-06-13T00:03:00.000Z";

function thread(overrides: Partial<ControlThread> = {}): ControlThread {
	return {
		id: "thread-1",
		sessionId: "session-1",
		forkedFromId: null,
		name: "Implement search",
		preview: "Add a thread filter",
		cwd: "/work/coz",
		model: "gpt-test",
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: null,
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		tagScore: null,
		lifecycleState: "active",
		desiredArchived: false,
		remoteArchived: false,
		remoteObservedAt: createdAt,
		remoteUpdatedAt: createdAt,
		localUpdatedAt: createdAt,
		runtimeSeenAt: createdAt,
		runtimeEpoch: 1,
		syncGeneration: 1,
		stateRevision: 1,
		lastOperationError: null,
		archivedAt: null,
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

describe("workbench project data", () => {
	it("groups threads by cwd and sorts projects and threads by recency", () => {
		const projects = buildWorkbenchProjects(
			[
				thread({
					id: "coz-old",
					cwd: "/work/coz",
					updatedAt: early,
					tokensUsed: 5,
				}),
				thread({
					id: "api-latest",
					cwd: "/work/api-server",
					updatedAt: late,
					tokensUsed: 10,
				}),
				thread({
					id: "coz-middle",
					cwd: "/work/coz",
					status: "active",
					activeTurnId: "turn-1",
					lastTurnStatus: "in_progress",
					updatedAt: middle,
					tokensUsed: 7,
				}),
			],
			"/work/coz",
		);

		expect(projects.map((project) => project.name)).toEqual([
			"api-server",
			"coz",
		]);
		expect(projects.map((project) => project.path)).toEqual([
			"/work/api-server",
			"/work/coz",
		]);
		expect(
			projects[1]?.threads.map((threadSummary) => threadSummary.threadId),
		).toEqual(["coz-middle", "coz-old"]);
		expect(projects[1]).toMatchObject({
			totalThreads: 2,
			runningThreads: 1,
			tokenTotal: 12,
		});
	});

	it("creates a default project when no threads are loaded", () => {
		const projects = buildWorkbenchProjects([], "/work/coz");

		expect(projects).toHaveLength(1);
		expect(projects[0]).toMatchObject({
			id: "/work/coz",
			name: "coz",
			threads: [],
			totalThreads: 0,
		});
	});

	it("finds the project that owns a thread", () => {
		const projects = buildWorkbenchProjects(
			[
				thread({ id: "a", cwd: "/work/a" }),
				thread({ id: "b", cwd: "/work/b" }),
			],
			"/work/a",
		);

		expect(findProjectForThread(projects, "b")?.path).toBe("/work/b");
		expect(findProjectForThread(projects, "missing")).toBeNull();
		expect(findProjectForThread(projects, null)).toBeNull();
	});

	it("buckets thread dates in UTC by default", () => {
		const projects = buildWorkbenchProjects(
			[
				thread({
					id: "late-yesterday",
					updatedAt: "2026-06-12T23:30:00.000Z",
				}),
			],
			"/work/coz",
			{ now: new Date("2026-06-13T00:30:00.000Z") },
		);

		expect(projects[0]?.threads[0]?.dateBucket).toBe("Yesterday");
	});

	it("uses a stable fallback path for an empty default cwd", () => {
		expect(emptyWorkbenchProject("")).toMatchObject({
			id: "No workspace",
			name: "No workspace",
		});
	});
});
