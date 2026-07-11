import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControlThread, ThreadItem } from "../src/server/domain.js";
import { currentDatabaseVersion, Store } from "../src/server/store.js";

let tempDir: string;

beforeEach(() => {
	tempDir = join(
		tmpdir(),
		`coz-store-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function createUnversionedDatabase(filePath: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY
    );
  `);
	db.close();
}

function createDatabaseWithVersion(filePath: string, version: string) {
	const db = new DatabaseSync(filePath);
	db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
	db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run(
		"version",
		version,
	);
	db.close();
}

function threadFixture(id: string): ControlThread {
	return {
		id,
		sessionId: id,
		forkedFromId: null,
		name: `Thread ${id}`,
		preview: "Preview",
		cwd: tempDir,
		model: "test-model",
		status: "idle",
		activeTurnId: null,
		lastTurnStatus: null,
		goalObjective: null,
		goalStatus: null,
		goalTokenBudget: null,
		tokensUsed: 0,
		tagScore: null,
		lifecycleState: "active",
		desiredArchived: null,
		remoteArchived: null,
		remoteObservedAt: null,
		remoteUpdatedAt: null,
		localUpdatedAt: "2026-06-13T00:00:00.000Z",
		runtimeSeenAt: null,
		runtimeEpoch: 0,
		syncGeneration: 0,
		stateRevision: 0,
		lastOperationError: null,
		archivedAt: null,
		createdAt: "2026-06-13T00:00:00.000Z",
		updatedAt: "2026-06-13T00:00:00.000Z",
	};
}

describe("store database version", () => {
	it("creates current-version databases", () => {
		const filePath = join(tempDir, "fresh.sqlite");
		const store = Store.open(filePath);
		try {
			const db = new DatabaseSync(filePath);
			const row = db
				.prepare("SELECT value FROM metadata WHERE key = ?")
				.get("version") as { value?: unknown } | undefined;
			db.close();
			expect(row?.value).toBe(currentDatabaseVersion);
		} finally {
			store.close();
		}
	});

	it("persists monotonic sync generations and runtime epochs", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread({
				...threadFixture("thread-active"),
				status: "active",
				activeTurnId: "turn-1",
				runtimeSeenAt: "2026-06-13T00:01:00.000Z",
			});
			expect(store.beginThreadSync()).toEqual({
				generation: 1,
				baseRevision: 1,
			});
			expect(store.beginThreadSync().generation).toBe(2);
			expect(store.beginRuntimeEpoch()).toBe(1);
			expect(store.getThread("thread-active")).toMatchObject({
				status: "not_loaded",
				activeTurnId: null,
				runtimeSeenAt: null,
				runtimeEpoch: 1,
			});
			expect(store.beginRuntimeEpoch()).toBe(2);
		} finally {
			store.close();
		}
	});

	it("rejects existing databases without version metadata", () => {
		const filePath = join(tempDir, "unversioned.sqlite");
		createUnversionedDatabase(filePath);

		expect(() => Store.open(filePath)).toThrow(
			`Database version is missing; expected "${currentDatabaseVersion}"`,
		);
	});

	it("rejects databases with a different version", () => {
		const filePath = join(tempDir, "wrong-version.sqlite");
		createDatabaseWithVersion(filePath, "v0");

		expect(() => Store.open(filePath)).toThrow(
			`Unsupported database version "v0"; expected "${currentDatabaseVersion}"`,
		);
	});

	it("rejects previous-version databases", () => {
		const filePath = join(tempDir, "v4.sqlite");
		createDatabaseWithVersion(filePath, "v4");

		expect(() => Store.open(filePath)).toThrow(
			`Unsupported database version "v4"; expected "${currentDatabaseVersion}"`,
		);
	});

	it("keeps archived threads out of default list queries", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-active"));
			store.createThread(threadFixture("thread-archived"));
			store.beginThreadOperation("thread-archived", "archive");
			store.confirmThreadOperation(
				"thread-archived",
				"archive",
				"2026-06-13T00:10:00.000Z",
			);

			expect(store.countThreads()).toBe(1);
			expect(store.listThreads().map((thread) => thread.id)).toEqual([
				"thread-active",
			]);
			expect(store.countThreads({ archived: true })).toBe(1);
			const archivedThreads = store.listThreads({ archived: true });
			expect(archivedThreads.map((thread) => thread.id)).toEqual([
				"thread-archived",
			]);
			expect(archivedThreads[0]?.archivedAt).toEqual(expect.any(String));
		} finally {
			store.close();
		}
	});

	it("persists lifecycle operations and effective archive visibility", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			const archive = store.beginThreadOperation("thread-1", "archive");
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "archive_pending",
				desiredArchived: true,
			});
			expect(store.getThread("thread-1")?.archivedAt).not.toBeNull();
			expect(store.listPendingThreadOperations()).toEqual([archive]);

			expect(store.markThreadOperationRunning(archive.id)).toMatchObject({
				status: "running",
				attempts: 1,
			});
			store.failThreadOperation("thread-1", "archive", "offline");
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "archive_failed",
				lastOperationError: "offline",
			});
			expect(store.getThread("thread-1")?.archivedAt).not.toBeNull();

			const retry = store.beginThreadOperation("thread-1", "archive");
			expect(retry.id).not.toBe(archive.id);
			store.confirmThreadOperation(
				"thread-1",
				"archive",
				"2026-06-13T00:10:00.000Z",
			);
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "archived",
				desiredArchived: true,
				remoteArchived: true,
				lastOperationError: null,
			});
			expect(store.listPendingThreadOperations()).toEqual([]);

			store.beginThreadOperation("thread-1", "unarchive");
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "unarchive_pending",
				desiredArchived: false,
				archivedAt: null,
			});
			store.failThreadOperation("thread-1", "unarchive", "offline");
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "unarchive_failed",
				archivedAt: null,
			});
		} finally {
			store.close();
		}
	});

	it("rejects stale remote snapshots after a local lifecycle intent", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			const sync = store.beginThreadSync();
			store.beginThreadOperation("thread-1", "archive");

			const stale = store.applyThreadRemoteState("thread-1", {
				archived: false,
				observedAt: "2026-06-13T00:05:00.000Z",
				generation: sync.generation,
				baseRevision: sync.baseRevision,
			});
			expect(stale.changed).toBe(false);
			expect(stale.thread).toMatchObject({
				lifecycleState: "archive_pending",
				desiredArchived: true,
			});

			const nextSync = store.beginThreadSync();
			const confirmed = store.applyThreadRemoteState("thread-1", {
				archived: true,
				observedAt: "2026-06-13T00:10:00.000Z",
				generation: nextSync.generation,
				baseRevision: nextSync.baseRevision,
			});
			expect(confirmed.thread).toMatchObject({
				lifecycleState: "archived",
				remoteArchived: true,
			});
			expect(store.listPendingThreadOperations()).toEqual([]);
		} finally {
			store.close();
		}
	});

	it("does not let stale discovery overwrite newer runtime state", () => {
		const store = Store.open(":memory:");
		try {
			const current = {
				...threadFixture("thread-1"),
				status: "active" as const,
				activeTurnId: "turn-new",
			};
			store.createThread(current);
			const sync = store.beginThreadSync();
			store.beginThreadOperation("thread-1", "archive");

			store.upsertDiscoveredThread(
				{ ...current, status: "idle", activeTurnId: null },
				{
					generation: sync.generation,
					baseRevision: sync.baseRevision,
					runtimeEpoch: 0,
				},
			);

			expect(store.getThread("thread-1")).toMatchObject({
				status: "active",
				activeTurnId: "turn-new",
				lifecycleState: "archive_pending",
			});
		} finally {
			store.close();
		}
	});

	it("rejects observations from an older runtime epoch", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			const sync = store.beginThreadSync();
			store.beginRuntimeEpoch();

			const result = store.applyThreadRemoteState("thread-1", {
				archived: true,
				generation: sync.generation,
				baseRevision: sync.baseRevision,
				runtimeEpoch: 0,
			});

			expect(result.changed).toBe(false);
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "active",
				remoteArchived: null,
				runtimeEpoch: 1,
			});
		} finally {
			store.close();
		}
	});

	it("does not mark a thread created during an older snapshot as missing", () => {
		const store = Store.open(":memory:");
		try {
			const sync = store.beginThreadSync();
			store.createThread(threadFixture("thread-created-during-sync"));

			store.markThreadMissing(
				"thread-created-during-sync",
				sync.generation,
				sync.baseRevision,
			);

			expect(store.getThread("thread-created-during-sync")).toMatchObject({
				lifecycleState: "active",
			});
		} finally {
			store.close();
		}
	});

	it("reconciles a late remote confirmation after an operation failure", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			const operation = store.beginThreadOperation("thread-1", "archive");
			store.markThreadOperationRunning(operation.id);
			store.failThreadOperation("thread-1", "archive", "response timed out");
			const sync = store.beginThreadSync();

			store.applyThreadRemoteState("thread-1", {
				archived: true,
				observedAt: "2026-06-13T00:10:00.000Z",
				generation: sync.generation,
				baseRevision: sync.baseRevision,
			});

			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "archived",
				remoteArchived: true,
				lastOperationError: null,
			});
			expect(store.getThreadOperation(operation.id)).toMatchObject({
				status: "succeeded",
				lastError: null,
			});
		} finally {
			store.close();
		}
	});

	it("does not let stale operation completion overwrite newer intent", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			store.beginThreadOperation("thread-1", "archive");
			const unarchive = store.beginThreadOperation("thread-1", "unarchive");

			store.confirmThreadOperation(
				"thread-1",
				"archive",
				"2026-06-13T00:05:00.000Z",
			);
			expect(store.getThread("thread-1")).toMatchObject({
				lifecycleState: "unarchive_pending",
				desiredArchived: false,
				remoteArchived: true,
				archivedAt: null,
			});
			store.failThreadOperation("thread-1", "archive", "stale failure");
			expect(store.getThread("thread-1")?.lifecycleState).toBe(
				"unarchive_pending",
			);
			expect(store.listPendingThreadOperations()).toEqual([unarchive]);
		} finally {
			store.close();
		}
	});

	it("keeps transcript rows when a thread becomes missing or deleted", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			store.createItem({
				id: "item-1",
				threadId: "thread-1",
				turnId: null,
				type: "agent",
				text: "kept",
				data: {},
				createdAt: "2026-06-13T00:00:01.000Z",
			});
			const sync = store.beginThreadSync();
			store.markThreadMissing("thread-1", sync.generation, sync.baseRevision);
			expect(store.getThread("thread-1")?.lifecycleState).toBe("missing");
			expect(store.listThreads()).toEqual([]);
			const operation = store.beginThreadOperation("thread-1", "archive");
			store.markThreadDeleted("thread-1", "2026-06-13T00:10:00.000Z");
			expect(store.getThread("thread-1")?.lifecycleState).toBe("deleted");
			expect(store.getThreadOperation(operation.id)).toMatchObject({
				status: "failed",
				lastError: "Thread was deleted",
			});
			expect(store.listThreads({ archived: true })).toEqual([]);
			expect(store.getItem("item-1")?.text).toBe("kept");
		} finally {
			store.close();
		}
	});

	it("updates thread tag scores without changing thread recency", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			const original = store.getThread("thread-1");
			expect(original?.tagScore).toBeNull();

			const scored = store.updateThreadTagScore("thread-1", 3);
			expect(scored).toMatchObject({
				id: "thread-1",
				tagScore: 3,
				updatedAt: original?.updatedAt,
			});

			const cleared = store.updateThreadTagScore("thread-1", null);
			expect(cleared).toMatchObject({
				id: "thread-1",
				tagScore: null,
				updatedAt: original?.updatedAt,
			});
		} finally {
			store.close();
		}
	});

	it("paginates thread items by stable item cursors", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			for (let index = 1; index <= 3; index += 1) {
				const item: ThreadItem = {
					id: `item-${index}`,
					threadId: "thread-1",
					turnId: null,
					type: "agent",
					text: `Item ${index}`,
					data: {},
					createdAt: `2026-06-13T00:00:0${index}.000Z`,
				};
				store.createItem(item);
			}

			const firstPage = store.listThreadItemsPage("thread-1", { limit: 2 });
			expect(firstPage.items.map((item) => item.id)).toEqual([
				"item-1",
				"item-2",
			]);
			expect(firstPage.direction).toBe("after");
			expect(firstPage.hasMore).toBe(true);
			expect(firstPage.nextCursor).toEqual({
				createdAt: "2026-06-13T00:00:02.000Z",
				id: "item-2",
			});

			const secondPage = store.listThreadItemsPage("thread-1", {
				limit: 2,
				cursor: firstPage.nextCursor,
			});
			expect(secondPage.items.map((item) => item.id)).toEqual(["item-3"]);
			expect(secondPage.hasMore).toBe(false);

			const latestPage = store.listThreadItemsPage("thread-1", {
				limit: 2,
				direction: "before",
			});
			expect(latestPage.items.map((item) => item.id)).toEqual([
				"item-2",
				"item-3",
			]);
			expect(latestPage.direction).toBe("before");
			expect(latestPage.hasMore).toBe(true);
			expect(latestPage.nextCursor).toEqual({
				createdAt: "2026-06-13T00:00:02.000Z",
				id: "item-2",
			});

			const earlierPage = store.listThreadItemsPage("thread-1", {
				limit: 2,
				direction: "before",
				cursor: latestPage.nextCursor,
			});
			expect(earlierPage.items.map((item) => item.id)).toEqual(["item-1"]);
			expect(earlierPage.hasMore).toBe(false);
		} finally {
			store.close();
		}
	});

	it("opens thread details with a bounded latest item window", () => {
		const store = Store.open(":memory:");
		try {
			store.createThread(threadFixture("thread-1"));
			for (let index = 1; index <= 205; index += 1) {
				const minute = Math.floor(index / 60);
				const second = index % 60;
				const item: ThreadItem = {
					id: `item-${String(index).padStart(3, "0")}`,
					threadId: "thread-1",
					turnId: null,
					type: "agent",
					text: `Item ${index}`,
					data: {},
					createdAt: `2026-06-13T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
				};
				store.createItem(item);
			}

			const detail = store.getThreadDetail("thread-1");
			expect(detail?.items).toHaveLength(200);
			expect(detail?.items[0]?.id).toBe("item-006");
			expect(detail?.items.at(-1)?.id).toBe("item-205");
			expect(detail?.itemTotalCount).toBe(205);
			expect(detail?.itemPageSize).toBe(200);
			expect(detail?.itemPageDirection).toBe("before");
			expect(detail?.itemHasMore).toBe(true);
			expect(detail?.itemNextCursor).toEqual({
				createdAt: "2026-06-13T00:00:06.000Z",
				id: "item-006",
			});
		} finally {
			store.close();
		}
	});

	it("limits event replay by count and payload bytes", () => {
		const store = Store.open(":memory:");
		try {
			store.appendEvent({
				type: "thread.started",
				threadId: null,
				turnId: null,
				payload: { text: "one" },
				createdAt: "2026-06-13T00:00:01.000Z",
			});
			store.appendEvent({
				type: "thread.started",
				threadId: null,
				turnId: null,
				payload: { text: "two".repeat(50) },
				createdAt: "2026-06-13T00:00:02.000Z",
			});
			store.appendEvent({
				type: "thread.started",
				threadId: null,
				turnId: null,
				payload: { text: "three" },
				createdAt: "2026-06-13T00:00:03.000Z",
			});

			expect(
				store.listEvents(0, { limit: 2 }).map((event) => event.id),
			).toEqual([1, 2]);
			expect(
				store.listEvents(0, { maxPayloadBytes: 30 }).map((event) => event.id),
			).toEqual([1]);
		} finally {
			store.close();
		}
	});
});
