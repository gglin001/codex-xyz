import {
	type GoalStatusUpdate,
	isSummaryEventType,
	type TerminalEvent,
} from "./domain.js";
import type { ControlService } from "./service.js";

const textEncoder = new TextEncoder();

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

		for (const event of input.replay(sseAfterId(url))) {
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
	return eventStreamResponse(request, url, {
		replay: (after) => service.replayEvents(after, { summaryOnly: true }),
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
	return eventStreamResponse(request, url, {
		replay: (after) => service.replayEvents(after, { threadId }),
		subscribe: (send) =>
			service.events.subscribe((event) => {
				if (event.threadId === threadId) {
					send(event);
				}
			}),
	});
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
			adapter: service.adapter.name,
		});
	}

	if (method === "GET" && url.pathname === "/api/state") {
		return jsonResponse(service.dashboard());
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
		if (url.searchParams.has("limit") || url.searchParams.has("offset")) {
			return jsonResponse(
				service.listThreadPage({
					limit: optionalQueryInteger(url, "limit", { min: 1 }),
					offset: optionalQueryInteger(url, "offset", { min: 0 }),
				}),
			);
		}
		return jsonResponse(service.listThreads());
	}

	if (method === "POST" && route === "api/threads") {
		const body = await readJson(request);
		return jsonResponse(
			await service.createSession({
				cwd: requireString(body, "cwd"),
				prompt: requireString(body, "prompt"),
				goalMode: optionalBoolean(body, "goalMode"),
				title: optionalString(body, "title"),
				model: optionalString(body, "model"),
			}),
			201,
		);
	}

	if (parts[0] === "api" && parts[1] === "threads" && parts[2]) {
		const threadId = parts[2];
		if (method === "GET" && parts.length === 3) {
			return jsonResponse(service.getThreadDetail(threadId));
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
					title: optionalString(body, "title"),
				}),
				201,
			);
		}

		if (method === "POST" && parts[3] === "compact") {
			return jsonResponse(await service.compactThread(threadId), 201);
		}

		if (method === "POST" && parts[3] === "interrupt") {
			return jsonResponse(await service.interruptTurn(threadId));
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
