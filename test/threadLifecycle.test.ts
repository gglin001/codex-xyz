import { describe, expect, it } from "vitest";
import {
	canArchiveThread,
	canUnarchiveThread,
	isThreadActive,
	isThreadArchived,
	isThreadRuntimeActionable,
	threadLifecycleLabel,
} from "../src/client/threadLifecycle.js";
import type { ThreadLifecycleState } from "../src/server/domain.js";

function lifecycleState(lifecycleState: ThreadLifecycleState) {
	return { lifecycleState };
}

describe("thread lifecycle UI rules", () => {
	it("keeps archive pending and failed threads out of the active list", () => {
		expect(isThreadActive(lifecycleState("active"))).toBe(true);
		expect(isThreadActive(lifecycleState("archive_pending"))).toBe(false);
		expect(isThreadActive(lifecycleState("archive_failed"))).toBe(false);
		expect(isThreadArchived(lifecycleState("archive_pending"))).toBe(true);
		expect(isThreadArchived(lifecycleState("archive_failed"))).toBe(true);
	});

	it("keeps desired unarchives visible while pending or failed", () => {
		expect(isThreadActive(lifecycleState("unarchive_pending"))).toBe(true);
		expect(isThreadActive(lifecycleState("unarchive_failed"))).toBe(true);
		expect(isThreadArchived(lifecycleState("unarchive_pending"))).toBe(false);
		expect(isThreadArchived(lifecycleState("unarchive_failed"))).toBe(false);
		expect(isThreadRuntimeActionable(lifecycleState("unarchive_pending"))).toBe(
			false,
		);
		expect(isThreadRuntimeActionable(lifecycleState("unarchive_failed"))).toBe(
			false,
		);
		expect(isThreadRuntimeActionable(lifecycleState("active"))).toBe(true);
	});

	it("offers retries only for failed lifecycle operations", () => {
		expect(canArchiveThread(lifecycleState("archive_failed"))).toBe(true);
		expect(canArchiveThread(lifecycleState("archive_pending"))).toBe(false);
		expect(canUnarchiveThread(lifecycleState("unarchive_failed"))).toBe(true);
		expect(canUnarchiveThread(lifecycleState("unarchive_pending"))).toBe(false);
	});

	it("does not expose deleted threads in either list", () => {
		expect(isThreadActive(lifecycleState("deleted"))).toBe(false);
		expect(isThreadArchived(lifecycleState("deleted"))).toBe(false);
		expect(threadLifecycleLabel(lifecycleState("deleted"))).toBe("Deleted");
	});
});
