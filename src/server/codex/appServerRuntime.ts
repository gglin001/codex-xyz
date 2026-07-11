import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
} from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import WebSocket from "ws";
import {
	type AppServerDebugLogLevel,
	allThreadSourceKinds,
	appServerInitializeParams,
	asRecord,
	clampDebugLogLevel,
	debugRecordLevel,
	extractThreadId,
	extractTurnId,
	inputText,
	isYoloApprovalRequest,
	type JsonRpcMessage,
	normalizeGoal,
	normalizeThread,
	normalizeThreadId,
	normalizeThreadItem,
	normalizeTurn,
	projectAppServerNotification,
	projectTurnStartedNotification,
	requestError,
	yoloApprovalResponse,
	yoloThreadOptions,
	yoloTurnOptions,
} from "./appServerProtocol.js";
import type {
	CodexAppServerRestartResult,
	CodexRuntime,
	CompactThreadInput,
	ForkThreadInput,
	ReadRuntimeConfigInput,
	ResumeThreadInput,
	RunShellCommandInput,
	RuntimeBackgroundTerminal,
	RuntimeConfigSnapshot,
	RuntimeEvent,
	RuntimeEventHandler,
	RuntimeThreadHistorySnapshot,
	RuntimeThreadListInput,
	RuntimeThreadPage,
	RuntimeThreadSearchInput,
	RuntimeThreadSearchPage,
	RuntimeThreadSnapshot,
	RuntimeTurnSnapshot,
	StartRuntimeTurnInput,
	StartThreadInput,
} from "./runtimePort.js";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	method: string;
	params: unknown;
	timeout: NodeJS.Timeout;
};

type PendingTurnStart = {
	prompt: string;
	resolve: (turn: RuntimeTurnSnapshot) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
};

type PendingTurnStartHandle = {
	promise: Promise<RuntimeTurnSnapshot>;
	cancel: (error: Error) => void;
};

function runtimeTimestamp(value: unknown) {
	const timestamp = typeof value === "number" ? value : 0;
	return new Date(
		timestamp > 10_000_000_000 ? timestamp : timestamp * 1000,
	).toISOString();
}

export type AppServerRuntimeOptions = {
	dataDir: string;
	debugLogPath?: string | null;
	debugLogLevel?: number | null;
	socketPath?: string | null;
	pidPath?: string | null;
};

type AppServerPersistentTransportOptions = {
	dataDir: string;
	socketPath: string;
	pidPath: string;
};

type AppServerListenerProcess = ChildProcess & {
	unref?: () => void;
};

type AppServerListenerState = {
	pid: number | null;
	socketPath: string;
};

const appServerSocketName = "codex-app-server.sock";
const appServerPidName = "codex-app-server.pid";
const appServerStartupTimeoutMs = 10_000;
const appServerPollIntervalMs = 50;
const appServerExitTimeoutMs = 2_000;
const appServerWebSocketPath = "/rpc";
const appServerMaxWebSocketPayloadBytes = 128 << 20;

class AppServerDebugLogger {
	private disabled = false;

	constructor(
		private readonly filePath: string,
		private readonly level: AppServerDebugLogLevel,
	) {
		mkdirSync(dirname(filePath), { recursive: true });
		appendFileSync(filePath, "", "utf8");
	}

	write(record: Record<string, unknown>) {
		if (this.disabled) {
			return;
		}
		const level = debugRecordLevel(record);
		if (level > this.level) {
			return;
		}
		try {
			appendFileSync(
				this.filePath,
				`${JSON.stringify({
					timestamp: new Date().toISOString(),
					level,
					target: "app-server",
					...record,
				})}\n`,
				"utf8",
			);
		} catch {
			this.disabled = true;
		}
	}
}

export class AppServerRuntime implements CodexRuntime {
	readonly name = "app-server";
	readonly version: string | null = null;
	private connection: WebSocket | null = null;
	private nextId = 1;
	private readonly pending = new Map<number | string, PendingRequest>();
	private readonly pendingTurnStarts = new Map<string, PendingTurnStart[]>();
	private eventHandler: RuntimeEventHandler = () => {};
	private initialized = false;
	private readonly debugLogger: AppServerDebugLogger | null;
	private readonly persistent: AppServerPersistentTransportOptions;
	private lifecycleLock = Promise.resolve();

	constructor(
		private readonly command = process.env.COZ_CODEX_BIN ?? "codex",
		options: AppServerRuntimeOptions,
	) {
		const dataDir = resolve(options.dataDir);
		this.persistent = {
			dataDir,
			socketPath: options.socketPath
				? resolve(options.socketPath)
				: join(dataDir, appServerSocketName),
			pidPath: options.pidPath
				? resolve(options.pidPath)
				: join(dataDir, appServerPidName),
		};
		const debugLogLevel = clampDebugLogLevel(options.debugLogLevel ?? 1);
		this.debugLogger =
			options.debugLogPath && debugLogLevel > 0
				? new AppServerDebugLogger(options.debugLogPath, debugLogLevel)
				: null;
	}

	onEvent(handler: RuntimeEventHandler) {
		this.eventHandler = handler;
	}

	async readConfig(
		input: ReadRuntimeConfigInput = {},
	): Promise<RuntimeConfigSnapshot> {
		const result = asRecord(
			await this.request("config/read", {
				includeLayers: input.includeLayers ?? false,
				cwd: input.cwd ?? undefined,
			}),
		);
		const config = asRecord(result.config);
		return {
			model: typeof config.model === "string" ? config.model : null,
			modelProvider:
				typeof config.model_provider === "string"
					? config.model_provider
					: null,
			serviceTier:
				typeof config.service_tier === "string" ? config.service_tier : null,
		};
	}

	async startThread(input: StartThreadInput): Promise<RuntimeThreadSnapshot> {
		const result = asRecord(
			await this.request("thread/start", {
				cwd: input.cwd,
				model: input.model ?? undefined,
				serviceName: "coz",
				threadSource: "user",
				...yoloThreadOptions,
			}),
		);
		const thread = normalizeThread(result.thread, result.model);
		return this.applyInitialThreadName(thread, input.name);
	}

	async listThreads(
		input: RuntimeThreadListInput = {},
	): Promise<RuntimeThreadPage> {
		const result = asRecord(
			await this.request("thread/list", {
				cursor: input.cursor ?? null,
				limit: input.limit ?? null,
				sortKey: "updated_at",
				sortDirection: "desc",
				archived: input.archived ?? false,
				cwd: input.cwd ?? null,
				sourceKinds: allThreadSourceKinds,
			}),
		);
		return {
			threads: Array.isArray(result.data)
				? result.data.map((thread) => normalizeThread(thread))
				: [],
			nextCursor:
				typeof result.nextCursor === "string" ? result.nextCursor : null,
		};
	}

	async searchThreads(
		input: RuntimeThreadSearchInput,
	): Promise<RuntimeThreadSearchPage> {
		const result = asRecord(
			await this.request("thread/search", {
				searchTerm: input.query,
				cursor: input.cursor ?? null,
				limit: input.limit ?? null,
				sortKey: "updated_at",
				sortDirection: "desc",
				archived: input.archived ?? false,
				sourceKinds: allThreadSourceKinds,
			}),
		);
		return {
			results: Array.isArray(result.data)
				? result.data.map((value) => {
						const entry = asRecord(value);
						return {
							thread: normalizeThread(entry.thread),
							snippet: typeof entry.snippet === "string" ? entry.snippet : "",
						};
					})
				: [],
			nextCursor:
				typeof result.nextCursor === "string" ? result.nextCursor : null,
		};
	}

	async readThread(threadId: string): Promise<RuntimeThreadSnapshot> {
		const result = asRecord(
			await this.request("thread/read", { threadId, includeTurns: false }),
		);
		return normalizeThread(result.thread);
	}

	async readThreadHistory(
		threadId: string,
	): Promise<RuntimeThreadHistorySnapshot> {
		const result = asRecord(
			await this.request("thread/turns/list", {
				threadId,
				limit: 50,
				sortDirection: "desc",
				itemsView: "full",
			}),
		);
		const turns = Array.isArray(result.data) ? result.data : [];
		return {
			turns: turns.map((value) => {
				const turn = asRecord(value);
				const rawItems = Array.isArray(turn.items) ? turn.items : [];
				const turnStartedAt = runtimeTimestamp(turn.startedAt);
				const items = rawItems.map((item, index) => {
					const normalized = normalizeThreadItem(item);
					return {
						id: normalized.itemId,
						type: normalized.itemType,
						text: normalized.text,
						data: normalized.data,
						createdAt: new Date(
							Date.parse(turnStartedAt) + index,
						).toISOString(),
					};
				});
				return {
					id: String(turn.id),
					status: normalizeTurn(turn).status,
					prompt: items.find((item) => item.type === "user")?.text ?? "",
					startedAt: turnStartedAt,
					completedAt:
						typeof turn.completedAt === "number"
							? runtimeTimestamp(turn.completedAt)
							: null,
					durationMs:
						typeof turn.durationMs === "number" ? turn.durationMs : null,
					items,
				};
			}),
			nextCursor:
				typeof result.nextCursor === "string" ? result.nextCursor : null,
		};
	}

	async resumeThread(input: ResumeThreadInput): Promise<RuntimeThreadSnapshot> {
		const result = asRecord(
			await this.request("thread/resume", {
				threadId: input.threadId,
				cwd: input.cwd,
				model: input.model ?? undefined,
				excludeTurns: true,
				...yoloThreadOptions,
			}),
		);
		return normalizeThread(result.thread, result.model);
	}

	async startTurn(input: StartRuntimeTurnInput): Promise<RuntimeTurnSnapshot> {
		const result = asRecord(
			await this.request("turn/start", {
				threadId: input.threadId,
				input: inputText(input.prompt),
				model: input.model ?? undefined,
				...yoloTurnOptions,
			}),
		);
		return normalizeTurn(result.turn);
	}

	async runShellCommand(
		input: RunShellCommandInput,
	): Promise<RuntimeTurnSnapshot> {
		const command = input.command.trim();
		if (!command) {
			throw new Error("Shell command must not be empty");
		}

		if (input.activeTurnId) {
			await this.request("thread/shellCommand", {
				threadId: input.threadId,
				command,
			});
			return {
				id: input.activeTurnId,
				status: "in_progress",
			};
		}

		const turnStarted = this.waitForTurnStart(
			input.threadId,
			`!${command}`,
			"thread/shellCommand did not start a turn",
		);
		try {
			await this.request("thread/shellCommand", {
				threadId: input.threadId,
				command,
			});
			return await turnStarted.promise;
		} catch (error) {
			turnStarted.cancel(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	}

	async compactThread(input: CompactThreadInput): Promise<RuntimeTurnSnapshot> {
		const turnStarted = this.waitForTurnStart(
			input.threadId,
			"/compact",
			"thread/compact/start did not start a turn",
		);
		try {
			await this.request("thread/compact/start", {
				threadId: input.threadId,
			});
			return await turnStarted.promise;
		} catch (error) {
			turnStarted.cancel(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	}

	async steerTurn(input: { threadId: string; turnId: string; prompt: string }) {
		await this.request("turn/steer", {
			threadId: input.threadId,
			expectedTurnId: input.turnId,
			input: inputText(input.prompt),
		});
	}

	async interruptTurn(input: { threadId: string; turnId: string }) {
		await this.request("turn/interrupt", {
			threadId: input.threadId,
			turnId: input.turnId,
		});
	}

	async forkThread(input: ForkThreadInput): Promise<RuntimeThreadSnapshot> {
		const result = asRecord(
			await this.request("thread/fork", {
				threadId: input.sourceThreadId,
				cwd: input.cwd,
				model: input.model ?? undefined,
				excludeTurns: true,
				...yoloThreadOptions,
			}),
		);
		const thread = normalizeThread(result.thread, result.model);
		return this.applyInitialThreadName(thread, input.name);
	}

	async archiveThread(threadId: string) {
		await this.request("thread/archive", { threadId });
	}

	async unarchiveThread(threadId: string) {
		await this.request("thread/unarchive", { threadId });
	}

	async setThreadName(input: { threadId: string; name: string }) {
		await this.request("thread/name/set", {
			threadId: input.threadId,
			name: input.name,
		});
	}

	private async applyInitialThreadName(
		thread: RuntimeThreadSnapshot,
		name?: string | null,
	) {
		const normalizedName = name?.trim();
		if (!normalizedName || thread.name === normalizedName) {
			return thread;
		}
		await this.setThreadName({
			threadId: thread.id,
			name: normalizedName,
		});
		return {
			...thread,
			name: normalizedName,
		};
	}

	async setGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}) {
		const result = asRecord(
			await this.request("thread/goal/set", {
				threadId: input.threadId,
				objective: input.objective,
				status: "active",
				tokenBudget: input.tokenBudget ?? null,
			}),
		);
		return normalizeGoal(result.goal);
	}

	async setGoalStatus(input: {
		threadId: string;
		status: "active" | "paused" | "complete";
	}) {
		const result = asRecord(
			await this.request("thread/goal/set", {
				threadId: input.threadId,
				status: input.status,
			}),
		);
		return normalizeGoal(result.goal);
	}

	async startGoal(input: {
		threadId: string;
		objective: string;
		tokenBudget?: number | null;
	}) {
		const turnStarted = this.waitForTurnStart(
			input.threadId,
			"",
			"thread/goal/set did not start a turn",
		);
		try {
			const goal = await this.setGoal(input);
			const turn = await turnStarted.promise;
			return { goal, turn };
		} catch (error) {
			turnStarted.cancel(
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	}

	async getGoal(threadId: string) {
		const result = asRecord(
			await this.request("thread/goal/get", { threadId }),
		);
		return result.goal ? normalizeGoal(result.goal) : null;
	}

	async clearGoal(threadId: string) {
		await this.request("thread/goal/clear", { threadId });
	}

	async listBackgroundTerminals(input: {
		threadId: string;
		limit?: number | null;
		cursor?: string | null;
	}): Promise<{
		terminals: RuntimeBackgroundTerminal[];
		nextCursor: string | null;
	}> {
		const result = asRecord(
			await this.request("thread/backgroundTerminals/list", {
				threadId: input.threadId,
				limit: input.limit ?? undefined,
				cursor: input.cursor ?? undefined,
			}),
		);
		const data = Array.isArray(result.data) ? result.data : [];
		return {
			terminals: data.map((terminal) => {
				const record = asRecord(terminal);
				const rssKb = record.rssKb ?? record.rss_kb;
				return {
					itemId: String(record.itemId ?? record.item_id ?? ""),
					processId: String(record.processId ?? record.process_id ?? ""),
					command: String(record.command ?? ""),
					cwd: String(record.cwd ?? ""),
					osPid:
						typeof record.osPid === "number"
							? record.osPid
							: typeof record.os_pid === "number"
								? record.os_pid
								: null,
					cpuPercent:
						typeof record.cpuPercent === "number"
							? record.cpuPercent
							: typeof record.cpu_percent === "number"
								? record.cpu_percent
								: null,
					rssKb:
						typeof rssKb === "number"
							? rssKb
							: typeof rssKb === "bigint"
								? Number(rssKb)
								: null,
				};
			}),
			nextCursor:
				typeof result.nextCursor === "string"
					? result.nextCursor
					: typeof result.next_cursor === "string"
						? result.next_cursor
						: null,
		};
	}

	async cleanBackgroundTerminals(threadId: string) {
		await this.request("thread/backgroundTerminals/clean", { threadId });
	}

	async restartAppServer(): Promise<CodexAppServerRestartResult> {
		return this.withLifecycleLock(async () => {
			await this.disconnectConnection("app-server runtime restarting");
			await this.stopPersistentAppServer();
			const listener = await this.ensurePersistentAppServer();
			await this.ensureStartedUnlocked();
			return {
				status: "restarted",
				pid: listener.pid,
				socketPath: listener.socketPath,
			};
		});
	}

	async close() {
		await this.withLifecycleLock(() =>
			this.disconnectConnection("app-server runtime closed"),
		);
	}

	private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.lifecycleLock;
		let release = () => {};
		this.lifecycleLock = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private async disconnectConnection(reason: string) {
		const error = new Error(reason);
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
		for (const pending of this.pendingTurnStarts.values()) {
			for (const turnStart of pending) {
				clearTimeout(turnStart.timeout);
				turnStart.reject(error);
			}
		}
		this.pendingTurnStarts.clear();
		const connection = this.connection;
		this.connection = null;
		this.initialized = false;
		closeWebSocket(connection);
	}

	private waitForTurnStart(
		threadId: string,
		prompt: string,
		timeoutMessage: string,
	): PendingTurnStartHandle {
		const key = normalizeThreadId(threadId);
		let entry: PendingTurnStart | null = null;
		const promise = new Promise<RuntimeTurnSnapshot>((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!entry) {
					return;
				}
				this.removePendingTurnStart(key, entry);
				reject(new Error(timeoutMessage));
			}, 10_000);
			entry = {
				prompt,
				resolve,
				reject,
				timeout,
			};
			const pending = this.pendingTurnStarts.get(key) ?? [];
			pending.push(entry);
			this.pendingTurnStarts.set(key, pending);
		});
		return {
			promise,
			cancel: (error: Error) => {
				if (!entry) {
					return;
				}
				if (!this.removePendingTurnStart(key, entry)) {
					return;
				}
				clearTimeout(entry.timeout);
				entry.reject(error);
			},
		};
	}

	private removePendingTurnStart(threadId: string, entry: PendingTurnStart) {
		const key = normalizeThreadId(threadId);
		const pending = this.pendingTurnStarts.get(key);
		if (!pending) {
			return false;
		}
		const next = pending.filter((candidate) => candidate !== entry);
		if (next.length === 0) {
			this.pendingTurnStarts.delete(key);
		} else {
			this.pendingTurnStarts.set(key, next);
		}
		return next.length !== pending.length;
	}

	private resolvePendingTurnStart(threadId: string, turn: RuntimeTurnSnapshot) {
		const key = normalizeThreadId(threadId);
		const pending = this.pendingTurnStarts.get(key);
		const turnStart = pending?.shift();
		if (!pending || !turnStart) {
			return null;
		}
		if (pending.length === 0) {
			this.pendingTurnStarts.delete(key);
		}
		clearTimeout(turnStart.timeout);
		turnStart.resolve(turn);
		return turnStart.prompt;
	}

	private async request(method: string, params: unknown): Promise<unknown> {
		await this.ensureStarted();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (this.pending.delete(id)) {
					reject(new Error(`app-server request timed out: ${method}`));
				}
			}, 60_000);
			this.pending.set(id, { resolve, reject, method, params, timeout });
			try {
				this.send({ id, method, params });
			} catch (error) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private async ensureStarted() {
		await this.withLifecycleLock(() => this.ensureStartedUnlocked());
	}

	private async ensureStartedUnlocked() {
		if (this.initialized && this.connection?.readyState === WebSocket.OPEN) {
			return;
		}
		this.initialized = false;
		if (this.connection?.readyState !== WebSocket.OPEN) {
			const connection = await this.openConnection();
			this.attachConnection(connection);
		}
		try {
			await this.initialize();
		} catch (error) {
			await this.disconnectConnection("app-server runtime initialize failed");
			throw error;
		}
	}

	private async openConnection() {
		await this.ensurePersistentAppServer();
		const connection = await openAppServerWebSocket(
			this.persistent.socketPath,
			appServerStartupTimeoutMs,
		);
		this.writeDebug({
			event: "connection.open",
			socketPath: this.persistent.socketPath,
		});
		return connection;
	}

	private attachConnection(connection: WebSocket) {
		this.connection = connection;
		connection.on("message", (data, isBinary) => {
			if (isBinary) {
				this.writeDebug({
					event: "message",
					direction: "in",
					parsed: false,
					line: "[binary websocket message]",
				});
				this.emitRaw("app-server/unparsed", {
					line: "[binary websocket message]",
				});
				return;
			}
			const text = rawWebSocketDataToText(data);
			if (text) {
				this.handlePayload(text);
			}
		});
		connection.on("error", (error) => {
			this.writeDebug({
				event: "connection.error",
				socketPath: this.persistent.socketPath,
				text: error.message,
			});
			this.emitRaw("app-server/stderr", { text: error.message });
		});
		connection.on("close", (code, reason) => {
			this.writeDebug({
				event: "connection.close",
				socketPath: this.persistent.socketPath,
				code,
				reason: reason.toString("utf8"),
			});
			this.handleConnectionClosed(
				connection,
				new Error(
					`app-server websocket closed with code ${code} reason ${reason.toString("utf8")}`,
				),
			);
		});
	}

	private spawnAppServerProcess(
		args: string[],
		options: SpawnOptions,
	): AppServerListenerProcess {
		const child = spawn(
			this.command,
			args,
			options,
		) as AppServerListenerProcess;
		this.writeDebug({
			event: "process.spawn",
			command: this.command,
			args,
			pid: child.pid ?? null,
		});
		return child;
	}

	private async ensurePersistentAppServer(): Promise<AppServerListenerState> {
		mkdirSync(this.persistent.dataDir, { recursive: true });
		if (await appServerAcceptsConnections(this.persistent.socketPath)) {
			return {
				pid: this.readPersistentAppServerPid(),
				socketPath: this.persistent.socketPath,
			};
		}
		this.removeStalePersistentFiles();

		const args = [
			"app-server",
			"--listen",
			`unix://${this.persistent.socketPath}`,
		];
		const child = this.spawnAppServerProcess(args, {
			stdio: ["ignore", "ignore", "ignore"],
			env: process.env,
			detached: true,
		});
		writeFileSync(this.persistent.pidPath, String(child.pid ?? ""), "utf8");
		child.unref?.();
		await waitForSocket(this.persistent.socketPath, appServerStartupTimeoutMs);
		return {
			pid: child.pid ?? null,
			socketPath: this.persistent.socketPath,
		};
	}

	private async stopPersistentAppServer() {
		const socketWasAccepting = await appServerAcceptsConnections(
			this.persistent.socketPath,
		);
		const pid = this.readPersistentAppServerPid();
		if (pid === null || !processExists(pid)) {
			if (socketWasAccepting) {
				this.writeDebug({
					event: "process.stop.stalePid",
					pid,
					socketPath: this.persistent.socketPath,
				});
			}
			this.removeStalePersistentFiles();
			return;
		}

		try {
			signalAppServerProcess(pid, "SIGTERM");
		} catch (error) {
			if (!isMissingProcessError(error)) {
				throw error;
			}
		}
		try {
			await waitForProcessExit(pid, appServerExitTimeoutMs);
			await waitForSocketClose(
				this.persistent.socketPath,
				appServerExitTimeoutMs,
			);
		} catch (error) {
			try {
				signalAppServerProcess(pid, "SIGKILL");
			} catch {}
			this.writeDebug({
				event: "process.stop.forceReplace",
				pid,
				socketPath: this.persistent.socketPath,
				text: error instanceof Error ? error.message : String(error),
			});
		}
		this.removeStalePersistentFiles();
	}

	private readPersistentAppServerPid() {
		if (!existsSync(this.persistent.pidPath)) {
			return null;
		}
		const value = Number(readFileSync(this.persistent.pidPath, "utf8").trim());
		return Number.isInteger(value) && value > 0 ? value : null;
	}

	private removeStalePersistentFiles() {
		rmSync(this.persistent.pidPath, { force: true });
		rmSync(this.persistent.socketPath, { force: true });
	}

	private async initialize() {
		const id = this.nextId++;
		const params = appServerInitializeParams;
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (this.pending.delete(id)) {
					reject(new Error("app-server initialize timed out"));
				}
			}, 30_000);
			this.pending.set(id, {
				resolve,
				reject,
				method: "initialize",
				params,
				timeout,
			});
			try {
				this.send({
					id,
					method: "initialize",
					params,
				});
			} catch (error) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		this.send({ method: "initialized" });
		this.initialized = true;
	}

	private handleConnectionClosed(connection: WebSocket, error: Error) {
		if (this.connection !== connection) {
			return;
		}
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
		for (const pending of this.pendingTurnStarts.values()) {
			for (const turnStart of pending) {
				clearTimeout(turnStart.timeout);
				turnStart.reject(error);
			}
		}
		this.pendingTurnStarts.clear();
		this.connection = null;
		this.initialized = false;
	}

	private handlePayload(payload: string) {
		const trimmed = payload.trim();
		if (!trimmed) {
			return;
		}
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(trimmed) as JsonRpcMessage;
		} catch {
			this.writeDebug({
				event: "message",
				direction: "in",
				parsed: false,
				line: trimmed,
			});
			this.emitRaw("app-server/unparsed", { line: trimmed });
			return;
		}
		this.writeDebug({
			event: "message",
			direction: "in",
			parsed: true,
			message,
		});

		if (
			message.id !== undefined &&
			(message.result !== undefined || message.error !== undefined)
		) {
			const pending = this.pending.get(message.id);
			if (pending) {
				this.pending.delete(message.id);
				clearTimeout(pending.timeout);
				if (message.error) {
					pending.reject(requestError(message.error, pending.params));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}

		if (message.method && message.id !== undefined) {
			this.handleServerRequest(message);
			return;
		}

		if (message.method) {
			this.handleNotification(message);
		}
	}

	private handleNotification(message: JsonRpcMessage) {
		const params = asRecord(message.params);
		const threadId = extractThreadId(params);
		const turnId = extractTurnId(params);

		if (message.method === "turn/started" && threadId) {
			const turn = normalizeTurn(asRecord(params.turn));
			const prompt = this.resolvePendingTurnStart(threadId, turn);
			const event = projectTurnStartedNotification(params, prompt);
			if (event) {
				this.eventHandler(event);
			}
			return;
		}

		const event = projectAppServerNotification(
			message.method ?? "notification",
			params,
		);
		if (event) {
			this.eventHandler(event);
			return;
		}
		this.emitRaw(message.method ?? "notification", params, threadId, turnId);
	}

	private handleServerRequest(message: JsonRpcMessage) {
		const params = asRecord(message.params);
		const threadId = extractThreadId(params);
		const turnId = extractTurnId(params);
		if (isYoloApprovalRequest(message.method)) {
			this.acceptYoloRequest(message, params);
			return;
		}
		this.emitRaw(message.method ?? "serverRequest", params, threadId, turnId);
	}

	private acceptYoloRequest(
		message: JsonRpcMessage,
		params: Record<string, unknown>,
	) {
		this.send({
			id: message.id,
			result: yoloApprovalResponse(message.method, params),
		});
	}

	private emitRaw(
		method: string,
		payload: Record<string, unknown>,
		threadId: string | null = null,
		turnId: string | null = null,
	) {
		this.eventHandler({
			type: "raw",
			method,
			threadId,
			turnId,
			payload,
		} satisfies RuntimeEvent);
	}

	private writeDebug(record: Record<string, unknown>) {
		this.debugLogger?.write(record);
	}

	private send(message: JsonRpcMessage) {
		const connection = this.connection;
		if (!connection || connection.readyState !== WebSocket.OPEN) {
			throw new Error("app-server websocket is not connected");
		}
		this.writeDebug({
			event: "message",
			direction: "out",
			parsed: true,
			message,
		});
		connection.send(JSON.stringify(message), (error) => {
			if (!error) {
				return;
			}
			this.writeDebug({
				event: "connection.error",
				socketPath: this.persistent.socketPath,
				text: error.message,
			});
			this.handleConnectionClosed(connection, error);
		});
	}
}

async function waitForSocket(socketPath: string, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	let lastError: Error | null = null;
	while (Date.now() < deadline) {
		try {
			if (await appServerAcceptsConnections(socketPath)) {
				return;
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
		await delay(appServerPollIntervalMs);
	}
	throw new Error(
		lastError
			? `app-server did not become ready on ${socketPath}: ${lastError.message}`
			: `app-server did not become ready on ${socketPath}`,
	);
}

async function waitForSocketClose(socketPath: string, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await appServerAcceptsConnections(socketPath))) {
			return;
		}
		await delay(appServerPollIntervalMs);
	}
	throw new Error(
		`app-server did not stop accepting connections on ${socketPath}`,
	);
}

async function appServerAcceptsConnections(socketPath: string) {
	try {
		const connection = await openAppServerWebSocket(socketPath, 500);
		closeWebSocket(connection);
		return true;
	} catch {
		return false;
	}
}

function openAppServerWebSocket(
	socketPath: string,
	timeoutMs: number,
): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const connection = new WebSocket(
			`ws://localhost${appServerWebSocketPath}`,
			{
				createConnection: (() =>
					createConnection(socketPath)) as typeof createConnection,
				handshakeTimeout: timeoutMs,
				maxPayload: appServerMaxWebSocketPayloadBytes,
				perMessageDeflate: false,
			},
		);
		let settled = false;
		const settle = (action: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			connection.off("open", onOpen);
			connection.off("error", onError);
			connection.off("close", onClose);
			action();
		};
		const onOpen = () => settle(() => resolve(connection));
		const onError = (error: Error) =>
			settle(() => {
				closeWebSocket(connection);
				reject(error);
			});
		const onClose = (code: number, reason: Buffer) =>
			settle(() => {
				reject(
					new Error(
						`app-server websocket closed during connect with code ${code} reason ${reason.toString("utf8")}`,
					),
				);
			});
		connection.once("open", onOpen);
		connection.once("error", onError);
		connection.once("close", onClose);
	});
}

function closeWebSocket(connection: WebSocket | null) {
	if (!connection) {
		return;
	}
	if (
		connection.readyState === WebSocket.OPEN ||
		connection.readyState === WebSocket.CONNECTING
	) {
		connection.close();
	}
	setTimeout(() => {
		if (connection.readyState !== WebSocket.CLOSED) {
			connection.terminate();
		}
	}, 250).unref();
}

function rawWebSocketDataToText(data: WebSocket.RawData) {
	if (typeof data === "string") {
		return data;
	}
	if (Buffer.isBuffer(data)) {
		return data.toString("utf8");
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString("utf8");
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}
	return "";
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processExists(pid)) {
			return;
		}
		await delay(appServerPollIntervalMs);
	}
	try {
		signalAppServerProcess(pid, "SIGKILL");
	} catch (error) {
		if (!isMissingProcessError(error)) {
			throw error;
		}
		return;
	}
	const killDeadline = Date.now() + timeoutMs;
	while (Date.now() < killDeadline) {
		if (!processExists(pid)) {
			return;
		}
		await delay(appServerPollIntervalMs);
	}
	throw new Error(`app-server process ${pid} did not exit`);
}

function signalAppServerProcess(pid: number, signal: NodeJS.Signals) {
	if (process.platform === "win32") {
		process.kill(pid, signal);
		return;
	}

	try {
		process.kill(-pid, signal);
	} catch (error) {
		if (!isMissingProcessError(error)) {
			throw error;
		}
		process.kill(pid, signal);
	}
}

function processExists(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isMissingProcessError(error)) {
			return false;
		}
		throw error;
	}
}

function isMissingProcessError(error: unknown) {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ESRCH"
	);
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
