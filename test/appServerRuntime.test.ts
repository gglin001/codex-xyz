import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectAppServerNotification } from "../src/server/codex/appServerProtocol.js";
import { AppServerRuntime } from "../src/server/codex/appServerRuntime.js";
import type { RuntimeEvent } from "../src/server/codex/runtimePort.js";

let tempDir: string | null = null;
let runtime: AppServerRuntime | null = null;
const sourceThreadId = "thread_00000000-0000-4000-8000-000000000001";
const debugThreadId = "thread_00000000-0000-4000-8000-000000000002";
const forkThreadId = "thread_00000000-0000-4000-8000-000000000003";
const turnId = "turn_00000000-0000-4000-8000-000000000004";
const goalTurnId = "turn_goal_00000000-0000-4000-8000-000000000005";
const compactTurnId = "turn_compact_00000000-0000-4000-8000-000000000006";
const startThreadId = "thread_00000000-0000-4000-8000-000000000007";

function createFakeCodexCommand() {
	tempDir = mkdtempSync(join(tmpdir(), "coz-app-server-"));
	process.env.FAKE_CODEX_REQUEST_LOG = requestLogPath();
	const commandPath = join(tempDir, "fake-codex.cjs");
	writeFileSync(
		commandPath,
		`#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const WebSocket = require("ws")

let output = process.stdout
const requestLogPath = process.env.FAKE_CODEX_REQUEST_LOG

function logRequest(message) {
  if (!requestLogPath || message.method === "initialized") {
    return
  }
  fs.appendFileSync(requestLogPath, JSON.stringify({
    id: message.id ?? null,
    method: message.method,
    params: message.params ?? null,
    result: message.result ?? null
  }) + "\\n")
}

function writeJson(message) {
  output.write(JSON.stringify(message) + "\\n")
}

function respond(id, result) {
  writeJson({ id, result })
}

function notify(method, params) {
  writeJson({ method, params })
}

function reject(id, message) {
  writeJson({ id, error: { message } })
}

function handle(message, state) {
  logRequest(message)

  if (message.method === "initialize") {
    state.experimentalApi = message.params?.capabilities?.experimentalApi === true
    respond(message.id, {
      userAgent: "fake-codex",
      codexHome: process.cwd(),
      platformFamily: "unix",
      platformOs: "macos"
    })
    return
  }

  if (message.method === "initialized") {
    return
  }

  if (message.method === "config/read") {
    respond(message.id, {
      config: {
        model: "fake-config-model",
        model_provider: "fake-provider",
        service_tier: null
      },
      origins: {},
      layers: null
    })
    return
  }

  if (message.method === "thread/start") {
    const model = message.params.model ?? "fake-config-model"
    respond(message.id, {
      thread: {
        id: "${startThreadId}",
        sessionId: "${startThreadId}",
        forkedFromId: null,
        preview: "started without turns",
        cwd: message.params.cwd,
        model,
        status: { type: "idle" },
        updatedAt: 1700000200
      },
      model
    })
    return
  }

  if (message.method === "thread/list") {
    respond(message.id, {
      data: [{
        id: "${sourceThreadId}",
        sessionId: "${sourceThreadId}",
        forkedFromId: null,
        name: "Historical thread",
        preview: "history preview",
        cwd: "/history",
        status: { type: "notLoaded" },
        updatedAt: 1700000300
      }],
      nextCursor: "history-next"
    })
    return
  }

  if (message.method === "thread/search") {
    respond(message.id, {
      data: [{
        thread: {
          id: "${sourceThreadId}",
          sessionId: "${sourceThreadId}",
          forkedFromId: null,
          name: "Historical thread",
          preview: "history preview",
          cwd: "/history",
          status: { type: "notLoaded" },
          updatedAt: 1700000300
        },
        snippet: "matching history"
      }],
      nextCursor: null
    })
    return
  }

  if (message.method === "thread/read") {
    respond(message.id, {
      thread: {
        id: message.params.threadId,
        sessionId: message.params.threadId,
        forkedFromId: null,
        name: "Historical thread",
        preview: "history preview",
        cwd: "/history",
        status: { type: "notLoaded" },
        updatedAt: 1700000300
      }
    })
    return
  }

  if (message.method === "thread/turns/list") {
    respond(message.id, {
      data: [{
        id: "${turnId}",
        status: "completed",
        startedAt: 1700000300,
        completedAt: 1700000301,
        durationMs: 1000,
        itemsView: "full",
        items: [
          { type: "userMessage", id: "history-user", clientId: null, content: [{ type: "text", text: "history prompt", text_elements: [] }] },
          { type: "agentMessage", id: "history-agent", text: "history answer", phase: null, memoryCitation: null }
        ],
        error: null
      }],
      nextCursor: "turns-next"
    })
    return
  }

  if (message.method === "thread/resume") {
    if (message.params?.excludeTurns === true && !state.experimentalApi) {
      reject(message.id, "thread/resume.excludeTurns requires experimentalApi capability")
      return
    }
    respond(message.id, {
      thread: {
        id: message.params.threadId,
        sessionId: message.params.threadId,
        forkedFromId: null,
        preview: "resumed without turns",
        cwd: message.params.cwd,
        model: message.params.model,
        status: { type: "idle" },
        updatedAt: 1700000000
      },
      model: message.params.model
    })
    return
  }

  if (message.method === "thread/fork") {
    respond(message.id, {
      thread: {
        id: "${forkThreadId}",
        sessionId: message.params.threadId,
        forkedFromId: message.params.threadId,
        preview: "forked without turns",
        cwd: message.params.cwd,
        model: message.params.model,
        status: { type: "idle" },
        updatedAt: 1700000100
      },
      model: message.params.model
    })
    return
  }

  if (message.method === "thread/archive") {
    respond(message.id, {})
    notify("thread/archived", {
      threadId: message.params.threadId
    })
    return
  }

  if (message.method === "thread/unarchive") {
    respond(message.id, {})
    notify("thread/unarchived", {
      threadId: message.params.threadId
    })
    return
  }

  if (message.method === "thread/compact/start") {
    const threadId = message.params.threadId
    respond(message.id, {})
    notify("turn/started", {
      threadId,
      turn: {
        id: "${compactTurnId}",
        items: [],
        itemsView: { type: "all" },
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null
      }
    })
    notify("item/started", {
      threadId,
      turnId: "${compactTurnId}",
      startedAtMs: 1,
      item: {
        type: "contextCompaction",
        id: "item_compact"
      }
    })
    notify("item/completed", {
      threadId,
      turnId: "${compactTurnId}",
      completedAtMs: 2,
      item: {
        type: "contextCompaction",
        id: "item_compact"
      }
    })
    notify("turn/completed", {
      threadId,
      turn: {
        id: "${compactTurnId}",
        items: [],
        itemsView: { type: "all" },
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 25
      }
    })
    return
  }

  if (message.method === "thread/name/set") {
    respond(message.id, {})
    notify("thread/name/updated", {
      threadId: message.params.threadId,
      threadName: message.params.name
    })
    return
  }

  if (message.method === "thread/goal/set") {
    const threadId = message.params.threadId
    const status = message.params.status ?? "active"
    const goal = {
      threadId,
      objective: message.params.objective ?? "Existing goal",
      status,
      tokenBudget: message.params.tokenBudget ?? null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1
    }
    respond(message.id, { goal })
    notify("thread/goal/updated", {
      threadId,
      turnId: null,
      goal
    })
    if (message.params.objective === undefined) {
      return
    }
    notify("turn/started", {
      threadId,
      turn: {
        id: "${goalTurnId}",
        items: [],
        itemsView: { type: "all" },
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null
      }
    })
    return
  }

  if (message.method === "turn/start") {
    const threadId = message.params.threadId
    respond(message.id, {
      turn: {
        id: "${turnId}",
        items: [],
        itemsView: { type: "all" },
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null
      }
    })
    notify("item/started", {
      threadId,
      turnId: "${turnId}",
      startedAtMs: Date.now(),
      item: {
        type: "commandExecution",
        id: "item_command",
        command: "pnpm test",
        cwd: process.cwd(),
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null
      }
    })
    notify("item/commandExecution/outputDelta", {
      threadId,
      turnId: "${turnId}",
      itemId: "item_command",
      delta: "running tests"
    })
    notify("item/agentMessage/delta", {
      threadId,
      turnId: "${turnId}",
      itemId: "item_agent",
      delta: "streamed answer"
    })
    notify("item/fileChange/patchUpdated", {
      threadId,
      turnId: "${turnId}",
      itemId: "item_file",
      changes: [
        {
          path: "src/client/App.tsx",
          kind: { type: "update", move_path: null },
          diff: "@@"
        }
      ]
    })
    notify("turn/plan/updated", {
      threadId,
      turnId: "${turnId}",
      explanation: "Plan",
      plan: [{ step: "Wire session controls", status: "completed" }]
    })
    notify("thread/tokenUsage/updated", {
      threadId,
      turnId: "${turnId}",
      tokenUsage: {
        total: {
          totalTokens: 42,
          inputTokens: 20,
          cachedInputTokens: 4,
          outputTokens: 18,
          reasoningOutputTokens: 2
        },
        last: {
          totalTokens: 42,
          inputTokens: 20,
          cachedInputTokens: 4,
          outputTokens: 18,
          reasoningOutputTokens: 2
        },
        modelContextWindow: 128000
      }
    })
    notify("thread/goal/updated", {
      threadId,
      turnId: "${turnId}",
      goal: {
        threadId,
        objective: "Finish UX",
        status: "active",
        tokenBudget: 1000,
        tokensUsed: 42,
        timeUsedSeconds: 1,
        createdAt: 1,
        updatedAt: 2
      }
    })
    notify("turn/completed", {
      threadId,
      turn: {
        id: "${turnId}",
        items: [],
        itemsView: { type: "all" },
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 50
      }
    })
    return
  }

  if (message.method === "turn/steer") {
    respond(message.id, {})
    return
  }

  if (message.method === "thread/backgroundTerminals/list") {
    respond(message.id, {
      data: [
        {
          item_id: "item_terminal",
          process_id: "process_1",
          command: "pnpm dev",
          cwd: process.cwd(),
          os_pid: 123,
          cpu_percent: 0.5,
          rss_kb: 2048
        }
      ],
      next_cursor: "cursor_2"
    })
    return
  }

  if (message.method === "thread/backgroundTerminals/clean") {
    respond(message.id, { count: 1 })
    return
  }

  if (message.method === "thread/shellCommand") {
    const turnId = "turn_shell_1"
    const itemId = "item_command_1"
    respond(message.id, {})
    writeJson({
      method: "turn/started",
      params: {
        threadId: message.params.threadId,
        turn: {
          id: turnId,
          items: [],
          itemsView: "none",
          status: "inProgress",
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null
        }
      }
    })
    writeJson({
      method: "item/started",
      params: {
        threadId: message.params.threadId,
        turnId,
        startedAtMs: 1,
        item: {
          type: "commandExecution",
          id: itemId,
          command: message.params.command,
          cwd: process.cwd(),
          processId: null,
          source: "userShell",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null
        }
      }
    })
    writeJson({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: message.params.threadId,
        turnId,
        itemId,
        delta: "fake cwd\\n"
      }
    })
    writeJson({
      method: "item/completed",
      params: {
        threadId: message.params.threadId,
        turnId,
        completedAtMs: 2,
        item: {
          type: "commandExecution",
          id: itemId,
          command: message.params.command,
          cwd: process.cwd(),
          processId: null,
          source: "userShell",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "fake cwd\\n",
          exitCode: 0,
          durationMs: 1
        }
      }
    })
    writeJson({
      method: "turn/completed",
      params: {
        threadId: message.params.threadId,
        turn: {
          id: turnId,
          items: [],
          itemsView: "none",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1
        }
      }
    })
  }
}

function serveWebSocket(socket) {
  const state = { experimentalApi: false }
  const out = {
    write(text) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(text)
      }
    }
  }
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      return
    }
    const currentOutput = output
    output = out
    try {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data)
      const lines = text.split("\\n")
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (line) {
          handle(JSON.parse(line), state)
        }
      }
    } finally {
      output = currentOutput
    }
  })
}

function socketPathFromListenArg(value) {
  const prefix = "unix://"
  if (!value?.startsWith(prefix)) {
    throw new Error("expected unix:// listen URL")
  }
  return value.slice(prefix.length)
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] !== "app-server") {
    throw new Error("expected app-server command")
  }
  if (args[1] === "--listen") {
    const socketPath = socketPathFromListenArg(args[2])
    fs.rmSync(socketPath, { force: true })
    const server = http.createServer()
    const wsServer = new WebSocket.Server({
      server,
      path: "/rpc",
      perMessageDeflate: false
    })
    wsServer.on("connection", (socket) => serveWebSocket(socket))
    server.listen(socketPath)
    process.on("SIGTERM", () => {
      wsServer.close()
      server.close(() => process.exit(0))
      setTimeout(() => process.exit(0), 50).unref()
    })
    return
  }
  throw new Error("unexpected app-server mode")
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
`,
	);
	chmodSync(commandPath, 0o755);
	return commandPath;
}

function appServerOptions(
	options: Partial<{
		debugLogPath: string | null;
		debugLogLevel: number | null;
	}> = {},
) {
	if (!tempDir) {
		throw new Error("Expected test temp dir");
	}
	return {
		dataDir: join(tempDir, ".coz"),
		...options,
	};
}

function readDebugRecords(debugLogPath: string) {
	const text = readFileSync(debugLogPath, "utf8").trim();
	if (!text) {
		return [];
	}
	return text
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function requestLogPath() {
	if (!tempDir) {
		throw new Error("Expected test temp dir");
	}
	return join(tempDir, ".coz", "requests.jsonl");
}

function readRequestLog() {
	try {
		const text = readFileSync(requestLogPath(), "utf8").trim();
		if (!text) {
			return [];
		}
		return text
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	} catch {
		return [];
	}
}

function debugRecordMethods(records: Array<Record<string, unknown>>) {
	return records.flatMap((record) => {
		const message =
			record.message && typeof record.message === "object"
				? (record.message as Record<string, unknown>)
				: {};
		return typeof message.method === "string" ? [message.method] : [];
	});
}

function appServerPidPath() {
	if (!tempDir) {
		throw new Error("Expected test temp dir");
	}
	return join(tempDir, ".coz", "codex-app-server.pid");
}

function appServerSocketPath() {
	if (!tempDir) {
		throw new Error("Expected test temp dir");
	}
	return join(tempDir, ".coz", "codex-app-server.sock");
}

function readAppServerPid() {
	try {
		const pid = Number(readFileSync(appServerPidPath(), "utf8").trim());
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function processExists(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ESRCH"
		);
	}
}

async function waitForProcessExit(pid: number) {
	const deadline = Date.now() + 1_000;
	while (Date.now() < deadline) {
		if (!processExists(pid)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

async function stopPid(pid: number) {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	await waitForProcessExit(pid);
	if (!processExists(pid)) {
		return;
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {}
}

async function stopFakePersistentAppServer() {
	const pid = readAppServerPid();
	if (pid === null) {
		return;
	}
	await stopPid(pid);
}

afterEach(async () => {
	await runtime?.close();
	runtime = null;
	await stopFakePersistentAppServer();
	delete process.env.FAKE_CODEX_REQUEST_LOG;
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("AppServerRuntime", () => {
	it("lists, searches, and reads app-server history without turns", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		const listed = await runtime.listThreads({ limit: 25 });
		const searched = await runtime.searchThreads({ query: "history" });
		const read = await runtime.readThread(sourceThreadId);
		const history = await runtime.readThreadHistory(sourceThreadId);

		expect(listed).toMatchObject({
			threads: [{ id: sourceThreadId, status: "not_loaded" }],
			nextCursor: "history-next",
		});
		expect(searched.results[0]).toMatchObject({
			thread: { id: sourceThreadId },
			snippet: "matching history",
		});
		expect(read.id).toBe(sourceThreadId);
		expect(history).toMatchObject({
			turns: [
				{
					id: turnId,
					status: "completed",
					prompt: "history prompt",
					items: [
						{ id: "history-user", type: "user" },
						{ id: "history-agent", type: "agent" },
					],
				},
			],
			nextCursor: "turns-next",
		});
		expect(readRequestLog()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					method: "thread/list",
					params: expect.objectContaining({
						sortKey: "updated_at",
						sortDirection: "desc",
						sourceKinds: expect.arrayContaining([
							"appServer",
							"subAgent",
							"subAgentThreadSpawn",
						]),
					}),
				}),
				expect.objectContaining({
					method: "thread/read",
					params: { threadId: sourceThreadId, includeTurns: false },
				}),
				expect.objectContaining({
					method: "thread/turns/list",
					params: {
						threadId: sourceThreadId,
						limit: 50,
						sortDirection: "desc",
						itemsView: "full",
					},
				}),
			]),
		);
	});

	it("reads the effective Codex config for a cwd", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		const config = await runtime.readConfig({ cwd: process.cwd() });
		const configReadRequest = readRequestLog().find(
			(request) => request.method === "config/read",
		);

		expect(config).toEqual({
			model: "fake-config-model",
			modelProvider: "fake-provider",
			serviceTier: null,
		});
		expect(configReadRequest?.params).toMatchObject({
			includeLayers: false,
			cwd: process.cwd(),
		});
	});

	it("reuses the persistent app-server across runtime instances", async () => {
		const command = createFakeCodexCommand();
		const options = appServerOptions();
		runtime = new AppServerRuntime(command, options);

		const firstThread = await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const firstPid = readAppServerPid();

		expect(firstThread.id).toBe(sourceThreadId);
		expect(firstPid).toEqual(expect.any(Number));

		await runtime.close();
		runtime = new AppServerRuntime(command, options);

		const secondThread = await runtime.resumeThread({
			threadId: debugThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		expect(secondThread.id).toBe(debugThreadId);
		expect(readAppServerPid()).toBe(firstPid);
	});

	it("restarts the persistent app-server and reconnects the socket", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const firstPid = readAppServerPid();

		const result = await runtime.restartAppServer();
		const secondPid = readAppServerPid();
		const thread = await runtime.resumeThread({
			threadId: debugThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		expect(firstPid).toEqual(expect.any(Number));
		expect(secondPid).toEqual(expect.any(Number));
		expect(secondPid).not.toBe(firstPid);
		expect(result).toEqual({
			status: "restarted",
			pid: secondPid,
			socketPath: appServerSocketPath(),
		});
		expect(thread.id).toBe(debugThreadId);
	});

	it("serializes concurrent app-server restarts", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		const results = await Promise.all([
			runtime.restartAppServer(),
			runtime.restartAppServer(),
			runtime.restartAppServer(),
			runtime.restartAppServer(),
		]);
		const finalPid = readAppServerPid();
		const thread = await runtime.resumeThread({
			threadId: debugThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		expect(finalPid).toEqual(expect.any(Number));
		expect(results.at(-1)?.pid).toBe(finalPid);
		if (finalPid === null) {
			throw new Error("Expected final app-server pid");
		}
		for (const result of results.slice(0, -1)) {
			if (result.pid === null) {
				throw new Error("Expected restarted app-server pid");
			}
			expect(result.pid).not.toBe(finalPid);
			expect(processExists(result.pid)).toBe(false);
		}
		expect(processExists(finalPid)).toBe(true);
		expect(thread.id).toBe(debugThreadId);
	});

	it("recovers restart when the app-server pid file is stale", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const oldPid = readAppServerPid();
		let stalePid = 999_999;
		while (processExists(stalePid)) {
			stalePid -= 1;
		}
		writeFileSync(appServerPidPath(), String(stalePid), "utf8");

		try {
			const result = await runtime.restartAppServer();
			const finalPid = readAppServerPid();
			const thread = await runtime.resumeThread({
				threadId: debugThreadId,
				cwd: process.cwd(),
				model: "test-model",
			});

			expect(oldPid).toEqual(expect.any(Number));
			expect(result.pid).toBe(finalPid);
			expect(finalPid).not.toBe(oldPid);
			if (finalPid === null) {
				throw new Error("Expected final app-server pid");
			}
			expect(processExists(finalPid)).toBe(true);
			expect(thread.id).toBe(debugThreadId);
		} finally {
			if (oldPid !== null) {
				await stopPid(oldPid);
			}
		}
	});

	it("stops the persisted app-server process when the socket probe fails", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const oldPid = readAppServerPid();
		rmSync(appServerSocketPath(), { force: true });

		try {
			const result = await runtime.restartAppServer();
			const finalPid = readAppServerPid();
			const thread = await runtime.resumeThread({
				threadId: debugThreadId,
				cwd: process.cwd(),
				model: "test-model",
			});

			expect(oldPid).toEqual(expect.any(Number));
			expect(result.pid).toBe(finalPid);
			expect(finalPid).not.toBe(oldPid);
			if (oldPid === null || finalPid === null) {
				throw new Error("Expected app-server pids");
			}
			expect(processExists(oldPid)).toBe(false);
			expect(processExists(finalPid)).toBe(true);
			expect(thread.id).toBe(debugThreadId);
		} finally {
			if (oldPid !== null) {
				await stopPid(oldPid);
			}
		}
	});

	it("opts into experimental fields before resuming without turns", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		const thread = await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		expect(thread).toMatchObject({
			id: sourceThreadId,
			preview: "resumed without turns",
			model: "test-model",
			updatedAt: "2023-11-14T22:13:20.000Z",
		});
	});

	it("sets the initial app-server thread name after starting", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());
		const events: RuntimeEvent[] = [];
		runtime.onEvent((event) => events.push(event));

		const thread = await runtime.startThread({
			cwd: process.cwd(),
			name: "Named start",
			preview: "Local prompt preview",
			model: "test-model",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(thread).toMatchObject({
			id: startThreadId,
			name: "Named start",
			preview: "started without turns",
			model: "test-model",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "thread.name.updated",
					threadId: startThreadId,
					name: "Named start",
				}),
			]),
		);
	});

	it("preserves app-server thread ids before callers reuse them", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		const source = await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const fork = await runtime.forkThread({
			sourceThreadId: source.id,
			cwd: process.cwd(),
			name: "Named fork",
			model: "test-model",
		});

		expect(fork).toMatchObject({
			id: forkThreadId,
			forkedFromId: sourceThreadId,
			name: "Named fork",
			preview: "forked without turns",
		});
	});

	it("archives threads through app-server and projects archive notifications", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());
		const events: RuntimeEvent[] = [];
		runtime.onEvent((event) => events.push(event));

		await runtime.archiveThread(sourceThreadId);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(events).toEqual([
			{
				type: "thread.archived",
				threadId: sourceThreadId,
			},
		]);
	});

	it("unarchives threads through app-server and projects lifecycle notifications", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());
		const events: RuntimeEvent[] = [];
		runtime.onEvent((event) => events.push(event));

		await runtime.unarchiveThread(sourceThreadId);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(events).toEqual([
			{
				type: "thread.unarchived",
				threadId: sourceThreadId,
			},
		]);
	});

	it("projects deleted thread notifications", () => {
		expect(
			projectAppServerNotification("thread/deleted", {
				threadId: sourceThreadId,
			}),
		).toEqual({
			type: "thread.deleted",
			threadId: sourceThreadId,
		});
	});

	it("writes app-server protocol debug records as JSON lines", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		runtime = new AppServerRuntime(
			command,
			appServerOptions({
				debugLogPath,
				debugLogLevel: 2,
			}),
		);

		await runtime.resumeThread({
			threadId: debugThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		const records = readDebugRecords(debugLogPath);
		const spawnedArgs = records.flatMap((record) =>
			record.event === "process.spawn" && Array.isArray(record.args)
				? [record.args]
				: [],
		);

		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					target: "app-server",
					event: "process.spawn",
				}),
				expect.objectContaining({
					direction: "out",
					message: expect.objectContaining({ method: "initialize" }),
				}),
				expect.objectContaining({
					direction: "out",
					message: expect.objectContaining({ method: "thread/resume" }),
				}),
				expect.objectContaining({
					direction: "in",
					message: expect.objectContaining({
						result: expect.objectContaining({
							thread: expect.objectContaining({
								id: debugThreadId,
							}),
						}),
					}),
				}),
			]),
		);
		expect(spawnedArgs).toEqual([
			["app-server", "--listen", `unix://${appServerSocketPath()}`],
		]);
		expect(spawnedArgs.flat()).not.toContain("proxy");
	});

	it("limits level 1 logs to operational records", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		runtime = new AppServerRuntime(
			command,
			appServerOptions({
				debugLogPath,
				debugLogLevel: 1,
			}),
		);

		await runtime.startTurn({
			threadId: debugThreadId,
			prompt: "Exercise basic logging",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		const records = readDebugRecords(debugLogPath);

		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					level: 1,
					event: "process.spawn",
				}),
			]),
		);
		expect(debugRecordMethods(records)).toEqual([]);
	});

	it("keeps high-volume stream deltas out of level 2 protocol logs", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		runtime = new AppServerRuntime(
			command,
			appServerOptions({
				debugLogPath,
				debugLogLevel: 2,
			}),
		);

		await runtime.startTurn({
			threadId: debugThreadId,
			prompt: "Exercise stream logging",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		const records = readDebugRecords(debugLogPath);
		const methods = debugRecordMethods(records);

		expect(methods).toContain("turn/start");
		expect(methods).not.toContain("item/agentMessage/delta");
		expect(records.some((record) => record.level === 3)).toBe(false);
	});

	it("writes high-volume stream deltas in level 3 protocol logs", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		runtime = new AppServerRuntime(
			command,
			appServerOptions({
				debugLogPath,
				debugLogLevel: 3,
			}),
		);

		await runtime.startTurn({
			threadId: debugThreadId,
			prompt: "Exercise verbose stream logging",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		const records = readDebugRecords(debugLogPath);

		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					level: 3,
					direction: "in",
					message: expect.objectContaining({
						method: "item/agentMessage/delta",
					}),
				}),
			]),
		);
	});

	it("normalizes app-server session control notifications", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());
		const events: RuntimeEvent[] = [];
		runtime.onEvent((event) => events.push(event));

		const thread = await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		await runtime.setThreadName({
			threadId: thread.id,
			name: "Control surface",
		});
		const turn = await runtime.startTurn({
			threadId: thread.id,
			prompt: "Exercise controls",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(turn).toMatchObject({
			id: turnId,
			status: "in_progress",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "thread.name.updated",
					threadId: thread.id,
					name: "Control surface",
				}),
				expect.objectContaining({
					type: "item.created",
					itemId: "item_command",
					itemType: "command",
				}),
				expect.objectContaining({
					type: "item.delta",
					itemId: "item_command",
					itemType: "command",
					delta: "running tests",
				}),
				expect.objectContaining({
					type: "item.updated",
					itemId: "item_file",
					itemType: "file",
				}),
				expect.objectContaining({
					type: "item.updated",
					itemId: `plan_${turnId}`,
					itemType: "plan",
				}),
				expect.objectContaining({
					type: "thread.token_usage",
					usage: expect.objectContaining({ totalTokens: 42 }),
				}),
				expect.objectContaining({
					type: "thread.goal",
					goal: expect.objectContaining({
						objective: "Finish UX",
						tokenBudget: 1000,
					}),
				}),
				expect.objectContaining({
					type: "turn.status",
					status: "completed",
					durationMs: 50,
				}),
			]),
		);
	});

	it("sends prompt text when starting and steering turns", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());
		const thread = await runtime.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		await runtime.startTurn({
			threadId: thread.id,
			prompt: "start prompt",
		});
		await runtime.steerTurn({
			threadId: thread.id,
			turnId,
			prompt: "steer prompt",
		});

		const requests = readRequestLog();
		const startRequest = requests.find(
			(request) => request.method === "turn/start",
		);
		const steerRequest = requests.find(
			(request) => request.method === "turn/steer",
		);

		expect(startRequest?.params).toMatchObject({
			threadId: thread.id,
			input: [{ type: "text", text: "start prompt", text_elements: [] }],
		});
		expect(steerRequest?.params).toMatchObject({
			threadId: thread.id,
			expectedTurnId: turnId,
			input: [{ type: "text", text: "steer prompt", text_elements: [] }],
		});
	});

	it("proxies background terminal list and clean through the app-server", async () => {
		const command = createFakeCodexCommand();
		runtime = new AppServerRuntime(command, appServerOptions());

		const page = await runtime.listBackgroundTerminals({
			threadId: sourceThreadId,
			limit: 10,
			cursor: "cursor_1",
		});
		await runtime.cleanBackgroundTerminals(sourceThreadId);

		expect(page).toEqual({
			terminals: [
				{
					itemId: "item_terminal",
					processId: "process_1",
					command: "pnpm dev",
					cwd: process.cwd(),
					osPid: 123,
					cpuPercent: 0.5,
					rssKb: 2048,
				},
			],
			nextCursor: "cursor_2",
		});
		const requests = readRequestLog();
		expect(
			requests.find(
				(request) => request.method === "thread/backgroundTerminals/list",
			)?.params,
		).toMatchObject({
			threadId: sourceThreadId,
			limit: 10,
			cursor: "cursor_1",
		});
		expect(
			requests.find(
				(request) => request.method === "thread/backgroundTerminals/clean",
			)?.params,
		).toEqual({
			threadId: sourceThreadId,
		});
	});

	it("starts goal mode by waiting for the app-server automatic turn", async () => {
		const command = createFakeCodexCommand();
		const events: RuntimeEvent[] = [];
		runtime = new AppServerRuntime(command, appServerOptions());
		runtime.onEvent((event) => events.push(event));

		const result = await runtime.startGoal({
			threadId: sourceThreadId,
			objective: "Finish the automatic goal flow",
			tokenBudget: 2048,
		});

		expect(result.goal).toMatchObject({
			objective: "Finish the automatic goal flow",
			status: "in_progress",
			tokenBudget: 2048,
		});
		expect(result.turn).toMatchObject({
			id: goalTurnId,
			status: "in_progress",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "thread.goal",
					threadId: sourceThreadId,
					goal: expect.objectContaining({
						objective: "Finish the automatic goal flow",
					}),
				}),
				expect.objectContaining({
					type: "turn.started",
					threadId: sourceThreadId,
					turnId: goalTurnId,
					prompt: "",
				}),
			]),
		);
	});

	it("updates goal status without starting a goal turn", async () => {
		const command = createFakeCodexCommand();
		const events: RuntimeEvent[] = [];
		runtime = new AppServerRuntime(command, appServerOptions());
		runtime.onEvent((event) => events.push(event));

		const goal = await runtime.setGoalStatus({
			threadId: sourceThreadId,
			status: "paused",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(goal).toMatchObject({
			objective: "Existing goal",
			status: "paused",
			tokenBudget: null,
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "thread.goal",
					threadId: sourceThreadId,
					goal: expect.objectContaining({
						status: "paused",
					}),
				}),
			]),
		);
		expect(events.some((event) => event.type === "turn.started")).toBe(false);
	});

	it("starts thread compaction through app-server and projects context item", async () => {
		const command = createFakeCodexCommand();
		const events: RuntimeEvent[] = [];
		runtime = new AppServerRuntime(command, appServerOptions());
		runtime.onEvent((event) => events.push(event));

		const turn = await runtime.compactThread({ threadId: sourceThreadId });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(turn).toMatchObject({
			id: compactTurnId,
			status: "in_progress",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "turn.started",
					threadId: sourceThreadId,
					turnId: compactTurnId,
					prompt: "/compact",
				}),
				expect.objectContaining({
					type: "item.created",
					threadId: sourceThreadId,
					turnId: compactTurnId,
					itemId: "item_compact",
					itemType: "system",
					text: "Compacted context",
				}),
				expect.objectContaining({
					type: "turn.status",
					threadId: sourceThreadId,
					turnId: compactTurnId,
					status: "completed",
					durationMs: 25,
				}),
			]),
		);
	});

	it("runs thread shell commands through app-server and projects command output", async () => {
		const command = createFakeCodexCommand();
		const events: RuntimeEvent[] = [];
		runtime = new AppServerRuntime(command, appServerOptions());
		runtime.onEvent((event) => events.push(event));

		const turn = await runtime.runShellCommand({
			threadId: sourceThreadId,
			command: "pwd",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(turn).toMatchObject({
			id: "turn_shell_1",
			status: "in_progress",
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "turn.started",
					threadId: sourceThreadId,
					turnId: "turn_shell_1",
					prompt: "!pwd",
				}),
				expect.objectContaining({
					type: "item.created",
					threadId: sourceThreadId,
					turnId: "turn_shell_1",
					itemId: "item_command_1",
					itemType: "command",
					text: "$ pwd\n",
				}),
				expect.objectContaining({
					type: "item.delta",
					itemId: "item_command_1",
					delta: "fake cwd\n",
				}),
				expect.objectContaining({
					type: "turn.status",
					threadId: sourceThreadId,
					turnId: "turn_shell_1",
					status: "completed",
				}),
			]),
		);
	});
});
