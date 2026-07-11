import {
	type CozEvent,
	type GoalStatusUpdate,
	isSummaryEventType,
	type TerminalEvent,
	type ThreadTagScore,
	type UserInputInteractionAnswers,
} from "./domain.js";
import type { ControlService } from "./service.js";

const textEncoder = new TextEncoder();
const defaultEventReplayLimit = 500;
const defaultEventReplayPayloadBytes = 512 * 1024;

function jsonResponse(body: unknown, status = 200) {
	return Response.json(body, {
		status,
		headers: {
			"cache-control": "no-store",
		},
	});
}

function noContentResponse() {
	return new Response(null, {
		status: 204,
		headers: {
			"cache-control": "no-store",
		},
	});
}

async function readJson(request: Request) {
	const text = await request.text();
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function requireString(body: Record<string, unknown>, key: string) {
	const value = body[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Missing string field: ${key}`);
	}
	return value.trim();
}

function requireRawString(body: Record<string, unknown>, key: string) {
	const value = body[key];
	if (typeof value !== "string") {
		throw new Error(`Missing string field: ${key}`);
	}
	return value;
}

function requireGoalStatusUpdate(
	body: Record<string, unknown>,
): GoalStatusUpdate {
	const status = requireString(body, "status");
	if (status === "active" || status === "paused" || status === "complete") {
		return status;
	}
	throw new Error("status must be active, paused, or complete");
}

function requireThreadTagScore(
	body: Record<string, unknown>,
): ThreadTagScore | null {
	const value = body.tagScore;
	if (value === null) {
		return null;
	}
	if (value === 1 || value === 2 || value === 3) {
		return value;
	}
	throw new Error("tagScore must be 1, 2, 3, or null");
}

function requireUserInputAnswers(
	body: Record<string, unknown>,
): UserInputInteractionAnswers {
	const value = body.answers;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("answers must be an object");
	}
	return Object.fromEntries(
		Object.entries(value).map(([questionId, rawAnswers]) => {
			if (
				!Array.isArray(rawAnswers) ||
				rawAnswers.length === 0 ||
				rawAnswers.some(
					(answer) => typeof answer !== "string" || answer.trim().length === 0,
				)
			) {
				throw new Error(
					`answers.${questionId} must be a non-empty string array`,
				);
			}
			return [
				questionId,
				rawAnswers.map((answer) => (answer as string).trim()),
			];
		}),
	);
}

function optionalString(body: Record<string, unknown>, key: string) {
	const value = body[key];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function optionalBoolean(body: Record<string, unknown>, key: string) {
	const value = body[key];
	return typeof value === "boolean" ? value : null;
}

function optionalPositiveInteger(body: Record<string, unknown>, key: string) {
	const value = body[key];
	if (value === undefined || value === null || value === "") {
		return null;
	}
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(number) || number <= 0) {
		throw new Error(`${key} must be a positive integer`);
	}
	return number;
}

function optionalQueryInteger(url: URL, key: string, options: { min: number }) {
	const value = url.searchParams.get(key);
	if (value === null || value.trim() === "") {
		return null;
	}
	const number = Number(value);
	if (!Number.isInteger(number) || number < options.min) {
		throw new Error(`${key} must be an integer >= ${options.min}`);
	}
	return number;
}

function optionalQueryBoolean(url: URL, key: string) {
	const value = url.searchParams.get(key);
	if (value === null || value.trim() === "") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "false" || normalized === "0") {
		return false;
	}
	throw new Error(`${key} must be true or false`);
}

function optionalThreadPageCursor(url: URL) {
	const updatedAt = url.searchParams.get("cursorUpdatedAt");
	const id = url.searchParams.get("cursorId");
	if (
		(updatedAt === null || updatedAt.trim() === "") &&
		(id === null || id.trim() === "")
	) {
		return null;
	}
	if (!updatedAt?.trim() || !id?.trim()) {
		throw new Error("cursorUpdatedAt and cursorId must be provided together");
	}
	return {
		updatedAt: updatedAt.trim(),
		id: id.trim(),
	};
}

function optionalThreadItemPageCursor(url: URL) {
	const createdAt = url.searchParams.get("cursorCreatedAt");
	const id = url.searchParams.get("cursorId");
	if (
		(createdAt === null || createdAt.trim() === "") &&
		(id === null || id.trim() === "")
	) {
		return null;
	}
	if (!createdAt?.trim() || !id?.trim()) {
		throw new Error("cursorCreatedAt and cursorId must be provided together");
	}
	return {
		createdAt: createdAt.trim(),
		id: id.trim(),
	};
}

function optionalThreadItemBeforeCursor(url: URL) {
	const createdAt = url.searchParams.get("beforeCreatedAt");
	const id = url.searchParams.get("beforeId");
	if (
		(createdAt === null || createdAt.trim() === "") &&
		(id === null || id.trim() === "")
	) {
		return null;
	}
	if (!createdAt?.trim() || !id?.trim()) {
		throw new Error("beforeCreatedAt and beforeId must be provided together");
	}
	return {
		createdAt: createdAt.trim(),
		id: id.trim(),
	};
}

function pathParts(url: URL) {
	return url.pathname
		.split("/")
		.filter(Boolean)
		.map((part) => decodeURIComponent(part));
}

function formatSse(event: string, data: unknown, id?: number) {
	let payload = "";
	if (id !== undefined) {
		payload += `id: ${id}\n`;
	}
	payload += `event: ${event}\n`;
	payload += `data: ${JSON.stringify(data)}\n\n`;
	return payload;
}

type SseSetup = (sendRaw: (payload: string) => void) => () => void;

function sseResponse(request: Request, setup: SseSetup) {
	let cleanup: (() => void) | null = null;
	let closeStream: (() => void) | null = null;

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;

			const close = () => {
				if (closed) {
					return;
				}
				closed = true;
				cleanup?.();
				cleanup = null;
				try {
					controller.close();
				} catch {
					// The stream may already be closed by the consumer.
				}
			};

			closeStream = close;
			const sendRaw = (payload: string) => {
				if (closed) {
					return;
				}
				try {
					controller.enqueue(textEncoder.encode(payload));
				} catch {
					close();
				}
			};

			if (request.signal.aborted) {
				close();
				return;
			}
			request.signal.addEventListener("abort", close, { once: true });
			cleanup = () => {
				request.signal.removeEventListener("abort", close);
			};
			const setupCleanup = setup(sendRaw);
			const abortCleanup = cleanup;
			cleanup = () => {
				abortCleanup?.();
				setupCleanup();
			};
		},
		cancel() {
			closeStream?.();
		},
	});

	return new Response(body, {
		status: 200,
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	});
}

function writeSseConnected(sendRaw: (payload: string) => void) {
	sendRaw(": connected\n\n");
}

function writeSse(
	sendRaw: (payload: string) => void,
	event: string,
	data: unknown,
	id?: number,
) {
	sendRaw(formatSse(event, data, id));
}

function sseAfterId(url: URL) {
	const after = Number(url.searchParams.get("after") ?? 0);
	return Number.isFinite(after) ? after : 0;
}

type StreamableEvent = {
	id?: number;
	sequence?: number;
	type: string;
};

type ResetEvent = {
	type: "events.reset";
	reason: string;
	after: number;
	latestEventId: number;
	threadId?: string | null;
};

function eventSequence(event: StreamableEvent) {
	return event.id ?? event.sequence;
}

function eventStreamResponse<TEvent extends StreamableEvent>(
	request: Request,
	url: URL,
	input: {
		replay: (after: number) => TEvent[];
		subscribe: (send: (event: TEvent) => void) => () => void;
	},
) {
	return sseResponse(request, (sendRaw) => {
		writeSseConnected(sendRaw);
		const send = (event: TEvent) =>
			writeSse(sendRaw, event.type, event, eventSequence(event));

		const after = sseAfterId(url);
		for (const event of input.replay(after)) {
			send(event);
		}
		const unsubscribe = input.subscribe(send);
		const heartbeat = setInterval(() => {
			sendRaw(": ping\n\n");
		}, 25_000);

		return () => {
			clearInterval(heartbeat);
			unsubscribe();
		};
	});
}

function summaryEventsResponse(
	service: ControlService,
	request: Request,
	url: URL,
) {
	return eventStreamResponse<CozEvent | ResetEvent>(request, url, {
		replay: (after) =>
			boundedReplay(service, after, {
				summaryOnly: true,
				threadId: null,
			}),
		subscribe: (send) =>
			service.events.subscribe((event) => {
				if (isSummaryEventType(event.type)) {
					send(event);
				}
			}),
	});
}

function threadEventsResponse(
	service: ControlService,
	request: Request,
	url: URL,
	threadId: string,
) {
	return eventStreamResponse<CozEvent | ResetEvent>(request, url, {
		replay: (after) => boundedReplay(service, after, { threadId }),
		subscribe: (send) =>
			service.events.subscribe((event) => {
				if (event.threadId === threadId) {
					send(event);
				}
			}),
	});
}

function boundedReplay(
	service: ControlService,
	after: number,
	options: {
		threadId?: string | null;
		summaryOnly?: boolean;
	},
): Array<CozEvent | ResetEvent> {
	const events = service.replayEvents(after, {
		...options,
		limit: defaultEventReplayLimit,
		maxPayloadBytes: defaultEventReplayPayloadBytes,
	});
	const latestEventId = service.getLatestReplayEventId(options);
	const lastEventId = events.at(-1)?.id ?? after;
	if (latestEventId > lastEventId) {
		return [
			...events,
			{
				type: "events.reset",
				reason: "replay_limit_exceeded",
				after,
				latestEventId,
				threadId: options.threadId ?? null,
			},
		];
	}
	return events;
}

function terminalEventsResponse(
	service: ControlService,
	request: Request,
	url: URL,
) {
	return eventStreamResponse<TerminalEvent>(request, url, {
		replay: (after) => service.terminal.replay(after),
		subscribe: (send) => service.terminal.subscribe(send),
	});
}

async function routeApiRequest(
	service: ControlService,
	request: Request,
	url: URL,
) {
	const method = request.method;

	if (method === "OPTIONS") {
		return noContentResponse();
	}

	if (method === "GET" && url.pathname === "/api/health") {
		return jsonResponse({
			ok: true,
			runtime: service.runtime.name,
		});
	}

	if (method === "GET" && url.pathname === "/api/state") {
		return jsonResponse(await service.dashboard());
	}

	if (method === "GET" && url.pathname === "/api/events") {
		return summaryEventsResponse(service, request, url);
	}

	if (method === "GET" && url.pathname === "/api/terminal") {
		return jsonResponse(await service.terminal.snapshot());
	}

	if (method === "GET" && url.pathname === "/api/terminal/events") {
		return terminalEventsResponse(service, request, url);
	}

	const parts = pathParts(url);
	const route = parts.join("/");

	if (method === "POST" && route === "api/runtime/app-server/restart") {
		return jsonResponse(await service.restartCodexAppServer());
	}

	if (method === "POST" && route === "api/terminal/start") {
		const body = await readJson(request);
		return jsonResponse(
			await service.terminal.start({
				cols: optionalPositiveInteger(body, "cols"),
				rows: optionalPositiveInteger(body, "rows"),
			}),
		);
	}

	if (method === "POST" && route === "api/terminal/input") {
		const body = await readJson(request);
		const data = requireRawString(body, "data");
		if (data.length > 0) {
			service.terminal.write(data);
		}
		return noContentResponse();
	}

	if (method === "POST" && route === "api/terminal/resize") {
		const body = await readJson(request);
		return jsonResponse(
			await service.terminal.resize({
				cols: optionalPositiveInteger(body, "cols"),
				rows: optionalPositiveInteger(body, "rows"),
			}),
		);
	}

	if (method === "POST" && route === "api/terminal/terminate") {
		return jsonResponse(await service.terminal.terminate());
	}

	if (method === "GET" && route === "api/threads") {
		const archived = optionalQueryBoolean(url, "archived");
		return jsonResponse(
			service.listThreadPage({
				limit: optionalQueryInteger(url, "limit", { min: 1 }),
				cursor: optionalThreadPageCursor(url),
				archived,
			}),
		);
	}

	if (method === "POST" && route === "api/threads/sync") {
		const body = await readJson(request);
		return jsonResponse(
			await service.syncThreadHistory({
				limit: optionalPositiveInteger(body, "limit"),
				cursor: optionalString(body, "cursor"),
				archived: optionalBoolean(body, "archived"),
			}),
		);
	}

	if (method === "GET" && route === "api/threads/search") {
		const query = url.searchParams.get("q")?.trim();
		if (!query) {
			throw new Error("q is required");
		}
		return jsonResponse(
			await service.searchThreadHistory({
				query,
				limit: optionalQueryInteger(url, "limit", { min: 1 }),
				cursor: url.searchParams.get("cursor"),
				archived: optionalQueryBoolean(url, "archived"),
			}),
		);
	}

	if (method === "POST" && route === "api/threads") {
		const body = await readJson(request);
		return jsonResponse(
			await service.createThread({
				cwd: requireString(body, "cwd"),
				prompt: requireString(body, "prompt"),
				goalMode: optionalBoolean(body, "goalMode"),
				name: optionalString(body, "name"),
				model: optionalString(body, "model"),
			}),
			201,
		);
	}

	if (parts[0] === "api" && parts[1] === "threads" && parts[2]) {
		const threadId = parts[2];
		if (method === "GET" && parts.length === 3) {
			return jsonResponse(await service.getHydratedThreadDetail(threadId));
		}

		if (method === "GET" && parts[3] === "items") {
			const cursor = optionalThreadItemPageCursor(url);
			const beforeCursor = optionalThreadItemBeforeCursor(url);
			if (cursor && beforeCursor) {
				throw new Error(
					"cursorCreatedAt/cursorId cannot be combined with beforeCreatedAt/beforeId",
				);
			}
			return jsonResponse(
				service.listThreadItemsPage(threadId, {
					limit: optionalQueryInteger(url, "limit", { min: 1 }),
					direction: beforeCursor ? "before" : "after",
					cursor: beforeCursor ?? cursor,
				}),
			);
		}

		if (method === "GET" && parts[3] === "events") {
			return threadEventsResponse(service, request, url, threadId);
		}

		if (method === "POST" && parts[3] === "turns") {
			const body = await readJson(request);
			const turn = await service.startTurn({
				threadId,
				prompt: requireString(body, "prompt"),
				model: optionalString(body, "model"),
			});
			return jsonResponse(turn, 201);
		}

		if (
			method === "POST" &&
			parts[3] === "interactions" &&
			parts[4] &&
			parts[5] === "answer"
		) {
			const body = await readJson(request);
			return jsonResponse(
				await service.answerUserInput({
					threadId,
					interactionId: parts[4],
					answers: requireUserInputAnswers(body),
				}),
			);
		}

		if (method === "POST" && parts[3] === "resume") {
			return jsonResponse(await service.resumeThread(threadId));
		}

		if (method === "POST" && parts[3] === "fork") {
			const body = await readJson(request);
			return jsonResponse(
				await service.forkThread({
					threadId,
					cwd: optionalString(body, "cwd"),
					model: optionalString(body, "model"),
					name: optionalString(body, "name"),
				}),
				201,
			);
		}

		if (method === "POST" && parts[3] === "compact") {
			return jsonResponse(await service.compactThread(threadId), 201);
		}

		if (method === "POST" && parts[3] === "archive") {
			return jsonResponse(await service.archiveThread(threadId));
		}

		if (method === "PUT" && parts[3] === "tag") {
			const body = await readJson(request);
			return jsonResponse(
				service.setThreadTagScore({
					threadId,
					tagScore: requireThreadTagScore(body),
				}),
			);
		}

		if (method === "POST" && parts[3] === "interrupt") {
			return jsonResponse(await service.interruptTurn(threadId));
		}

		if (parts[3] === "background-terminals") {
			if (method === "GET" && parts.length === 4) {
				return jsonResponse(await service.listBackgroundTerminals(threadId));
			}
			if (method === "POST" && parts[4] === "clean" && parts.length === 5) {
				return jsonResponse(await service.cleanBackgroundTerminals(threadId));
			}
		}

		if (parts[3] === "goal") {
			if (method === "GET" && parts.length === 4) {
				return jsonResponse(await service.getGoal(threadId));
			}
			if (method === "PUT" && parts[4] === "status" && parts.length === 5) {
				const body = await readJson(request);
				return jsonResponse(
					await service.setGoalStatus({
						threadId,
						status: requireGoalStatusUpdate(body),
					}),
				);
			}
			if (method === "PUT" && parts.length === 4) {
				const body = await readJson(request);
				return jsonResponse(
					await service.startGoal({
						threadId,
						objective: requireString(body, "objective"),
						tokenBudget: optionalPositiveInteger(body, "tokenBudget"),
					}),
				);
			}
			if (method === "DELETE" && parts.length === 4) {
				return jsonResponse(await service.clearGoal(threadId));
			}
		}
	}

	return jsonResponse({ error: "Not found" }, 404);
}

export async function handleApiRequest(
	service: ControlService,
	request: Request,
) {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/api/")) {
		return null;
	}

	try {
		return await routeApiRequest(service, request, url);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return jsonResponse({ error: message }, 400);
	}
}
