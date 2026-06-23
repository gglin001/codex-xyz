import {
	type ControlThread,
	threadDisplayStatus,
} from "../../server/domain.js";
import type {
	DateBucket,
	ProjectAccent,
	WorkbenchProject,
	WorkbenchThread,
} from "./workbenchTypes.js";

const accentCycle: ProjectAccent[] = ["emerald", "violet", "sky", "slate"];

function bucketForDate(value: string, now = new Date()): DateBucket {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "Older";
	}

	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const startOfYesterday = new Date(startOfToday);
	startOfYesterday.setDate(startOfYesterday.getDate() - 1);

	if (date >= startOfToday) {
		return "Today";
	}
	if (date >= startOfYesterday) {
		return "Yesterday";
	}
	return "Older";
}

function basename(path: string) {
	const normalized = path.replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts.at(-1) || normalized || "Workspace";
}

function initialsForName(name: string) {
	const words = name
		.replace(/[-_.]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) {
		return "CX";
	}
	return words
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")
		.padEnd(2, "X")
		.slice(0, 2);
}

function stableIndex(value: string, modulo: number) {
	if (modulo <= 0) {
		return 0;
	}
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash + value.charCodeAt(index) * (index + 1)) % modulo;
	}
	return hash;
}

function workbenchThreadFromThread(thread: ControlThread): WorkbenchThread {
	return {
		id: thread.id,
		threadId: thread.id,
		sessionId: thread.sessionId,
		forkedFromId: thread.forkedFromId,
		name: thread.name || "Untitled Codex thread",
		preview: thread.preview || "No transcript preview yet.",
		cwd: thread.cwd || "Unknown workdir",
		model: thread.model,
		status: threadDisplayStatus(thread),
		runtimeStatus: thread.status,
		activeTurnId: thread.activeTurnId,
		lastTurnStatus: thread.lastTurnStatus,
		goalObjective: thread.goalObjective,
		goalStatus: thread.goalStatus,
		goalTokenBudget: thread.goalTokenBudget,
		tokensUsed: thread.tokensUsed,
		archivedAt: thread.archivedAt,
		createdAt: thread.createdAt,
		updatedAt: thread.updatedAt,
		dateBucket: bucketForDate(thread.updatedAt),
		thread,
	};
}

function sortThreads(threads: WorkbenchThread[]) {
	return [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function projectFromPath(
	path: string,
	threads: WorkbenchThread[],
): WorkbenchProject {
	const name = basename(path);
	const accent = accentCycle[stableIndex(path, accentCycle.length)] ?? "slate";
	const sortedThreads = sortThreads(threads);
	return {
		id: path,
		name,
		path,
		initials: initialsForName(name),
		accent,
		threads: sortedThreads,
		totalThreads: sortedThreads.length,
		runningThreads: sortedThreads.filter(
			(thread) => thread.runtimeStatus === "active",
		).length,
		tokenTotal: sortedThreads.reduce(
			(total, thread) => total + thread.tokensUsed,
			0,
		),
	};
}

export function emptyWorkbenchProject(defaultCwd: string): WorkbenchProject {
	const path = defaultCwd || "No workspace";
	return projectFromPath(path, []);
}

export function buildWorkbenchProjects(
	threads: ControlThread[],
	defaultCwd: string,
): WorkbenchProject[] {
	const grouped = new Map<string, WorkbenchThread[]>();

	for (const thread of threads) {
		const workbenchThread = workbenchThreadFromThread(thread);
		const key = workbenchThread.cwd;
		const projectThreads = grouped.get(key);
		if (projectThreads) {
			projectThreads.push(workbenchThread);
		} else {
			grouped.set(key, [workbenchThread]);
		}
	}

	if (grouped.size === 0) {
		return [emptyWorkbenchProject(defaultCwd)];
	}

	return [...grouped.entries()]
		.map(([path, threads]) => projectFromPath(path, threads))
		.sort((a, b) => {
			const aLatest = a.threads[0]?.updatedAt ?? "";
			const bLatest = b.threads[0]?.updatedAt ?? "";
			return bLatest.localeCompare(aLatest) || a.name.localeCompare(b.name);
		});
}

export function findProjectForThread(
	projects: WorkbenchProject[],
	threadId: string | null,
) {
	if (!threadId) {
		return null;
	}
	return (
		projects.find((project) =>
			project.threads.some((thread) => thread.threadId === threadId),
		) ?? null
	);
}
