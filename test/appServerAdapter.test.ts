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
import type { AdapterEvent } from "../src/server/codex/adapter.js";
import { AppServerCodexAdapter } from "../src/server/codex/appServerAdapter.js";

let tempDir: string | null = null;
let adapter: AppServerCodexAdapter | null = null;
const sourceThreadId = "00000000-0000-4000-8000-000000000001";
const debugThreadId = "00000000-0000-4000-8000-000000000002";
const forkThreadId = "00000000-0000-4000-8000-000000000003";
const turnId = "turn_00000000-0000-4000-8000-000000000004";
const goalTurnId = "turn_goal_00000000-0000-4000-8000-000000000005";

function createFakeCodexCommand() {
	tempDir = mkdtempSync(join(tmpdir(), "coz-app-server-"));
	const commandPath = join(tempDir, "fake-codex.cjs");
	writeFileSync(
		commandPath,
		`#!/usr/bin/env node
let buffer = ""
let experimentalApi = false

function respond(id, result) {
  process.stdout.write(JSON.stringify({ id, result }) + "\\n")
}

function notify(method, params) {
  process.stdout.write(JSON.stringify({ method, params }) + "\\n")
}

function reject(id, message) {
  process.stdout.write(JSON.stringify({ id, error: { message } }) + "\\n")
}

function handle(message) {
  if (message.method === "initialize") {
    experimentalApi = message.params?.capabilities?.experimentalApi === true
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

  if (message.method === "thread/resume") {
    if (message.params?.excludeTurns === true && !experimentalApi) {
      reject(message.id, "thread/resume.excludeTurns requires experimentalApi capability")
      return
    }
    if (!/^[0-9a-f-]{36}$/i.test(message.params?.threadId ?? "")) {
      reject(message.id, "invalid session id")
      return
    }
    respond(message.id, {
      thread: {
        id: "thread_" + message.params.threadId,
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
    if (!/^[0-9a-f-]{36}$/i.test(message.params?.threadId ?? "")) {
      reject(message.id, "invalid session id")
      return
    }
    respond(message.id, {
      thread: {
        id: "thread_00000000-0000-4000-8000-000000000003",
        sessionId: message.params.threadId,
        forkedFromId: "thread_" + message.params.threadId,
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

  if (message.method === "thread/shellCommand") {
    const turnId = "turn_shell_1"
    const itemId = "item_command_1"
    respond(message.id, {})
    process.stdout.write(JSON.stringify({
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
    }) + "\\n")
    process.stdout.write(JSON.stringify({
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
    }) + "\\n")
    process.stdout.write(JSON.stringify({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: message.params.threadId,
        turnId,
        itemId,
        delta: "fake cwd\\n"
      }
    }) + "\\n")
    process.stdout.write(JSON.stringify({
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
    }) + "\\n")
    process.stdout.write(JSON.stringify({
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
    }) + "\\n")
  }
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf("\\n")
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      handle(JSON.parse(line))
    }
    newline = buffer.indexOf("\\n")
  }
})
`,
	);
	chmodSync(commandPath, 0o755);
	return commandPath;
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

function debugRecordMethods(records: Array<Record<string, unknown>>) {
	return records.flatMap((record) => {
		const message =
			record.message && typeof record.message === "object"
				? (record.message as Record<string, unknown>)
				: {};
		return typeof message.method === "string" ? [message.method] : [];
	});
}

afterEach(async () => {
	await adapter?.close();
	adapter = null;
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("AppServerCodexAdapter", () => {
	it("opts into experimental fields before resuming without turns", async () => {
		const command = createFakeCodexCommand();
		adapter = new AppServerCodexAdapter(command);

		const thread = await adapter.resumeThread({
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

	it("normalizes app-server thread ids before callers reuse them", async () => {
		const command = createFakeCodexCommand();
		adapter = new AppServerCodexAdapter(command);

		const source = await adapter.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		const fork = await adapter.forkThread({
			sourceThreadId: source.id,
			cwd: process.cwd(),
			model: "test-model",
		});

		expect(fork).toMatchObject({
			id: forkThreadId,
			forkedFromId: sourceThreadId,
			preview: "forked without turns",
		});
	});

	it("writes app-server protocol debug records as JSON lines", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		adapter = new AppServerCodexAdapter(command, {
			debugLogPath,
			debugLogLevel: 2,
		});

		await adapter.resumeThread({
			threadId: debugThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});

		const records = readDebugRecords(debugLogPath);

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
								id: `thread_${debugThreadId}`,
							}),
						}),
					}),
				}),
			]),
		);
	});

	it("limits level 1 logs to operational records", async () => {
		const command = createFakeCodexCommand();
		const debugLogPath = join(tempDir as string, ".coz", "debug.jsonl");
		adapter = new AppServerCodexAdapter(command, {
			debugLogPath,
			debugLogLevel: 1,
		});

		await adapter.startTurn({
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
		adapter = new AppServerCodexAdapter(command, {
			debugLogPath,
			debugLogLevel: 2,
		});

		await adapter.startTurn({
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
		adapter = new AppServerCodexAdapter(command, {
			debugLogPath,
			debugLogLevel: 3,
		});

		await adapter.startTurn({
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
		adapter = new AppServerCodexAdapter(command);
		const events: AdapterEvent[] = [];
		adapter.onEvent((event) => events.push(event));

		const thread = await adapter.resumeThread({
			threadId: sourceThreadId,
			cwd: process.cwd(),
			model: "test-model",
		});
		await adapter.renameThread({
			threadId: thread.id,
			title: "Control surface",
		});
		const turn = await adapter.startTurn({
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
					type: "thread.renamed",
					threadId: thread.id,
					title: "Control surface",
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

	it("starts goal mode by waiting for the app-server automatic turn", async () => {
		const command = createFakeCodexCommand();
		const events: AdapterEvent[] = [];
		adapter = new AppServerCodexAdapter(command);
		adapter.onEvent((event) => events.push(event));

		const result = await adapter.startGoal({
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
		const events: AdapterEvent[] = [];
		adapter = new AppServerCodexAdapter(command);
		adapter.onEvent((event) => events.push(event));

		const goal = await adapter.setGoalStatus({
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

	it("runs thread shell commands through app-server and projects command output", async () => {
		const command = createFakeCodexCommand();
		const events: AdapterEvent[] = [];
		adapter = new AppServerCodexAdapter(command);
		adapter.onEvent((event) => events.push(event));

		const turn = await adapter.runShellCommand({
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
