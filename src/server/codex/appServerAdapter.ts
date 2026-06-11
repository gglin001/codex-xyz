import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  type AdapterEvent,
  type AdapterEventHandler,
  type AdapterGoal,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "./adapter.js";

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function inputText(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function normalizeThread(value: unknown): AdapterThread {
  const thread = asRecord(value);
  return {
    id: String(thread.id),
    sessionId: String(thread.sessionId ?? thread.id),
    forkedFromId: typeof thread.forkedFromId === "string" ? thread.forkedFromId : null,
    preview: String(thread.preview ?? ""),
    cwd: String(thread.cwd ?? process.cwd()),
    model: typeof thread.model === "string" ? thread.model : null
  };
}

function normalizeTurn(value: unknown): AdapterTurn {
  const turn = asRecord(value);
  const status = String(turn.status ?? "running");
  return {
    id: String(turn.id),
    status: status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "running"
  };
}

function extractThreadId(params: Record<string, unknown>) {
  return typeof params.threadId === "string" ? params.threadId : null;
}

function extractTurnId(params: Record<string, unknown>) {
  return typeof params.turnId === "string" ? params.turnId : null;
}

export class AppServerCodexAdapter implements CodexAdapter {
  readonly name = "app-server";
  readonly version: string | null = null;
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdout: Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private eventHandler: AdapterEventHandler = () => {};
  private initialized = false;

  constructor(private readonly command = process.env.CODEX_XYZ_CODEX_BIN ?? "codex") {}

  onEvent(handler: AdapterEventHandler) {
    this.eventHandler = handler;
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    const result = asRecord(
      await this.request("thread/start", {
        cwd: input.cwd,
        model: input.model ?? undefined,
        serviceName: "codex-xyz",
        threadSource: "user"
      })
    );
    return normalizeThread(result.thread);
  }

  async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
    const result = asRecord(
      await this.request("turn/start", {
        threadId: input.threadId,
        input: inputText(input.prompt),
        model: input.model ?? undefined
      })
    );
    return normalizeTurn(result.turn);
  }

  async steerTurn(input: { threadId: string; turnId: string; prompt: string }) {
    await this.request("turn/steer", {
      threadId: input.threadId,
      expectedTurnId: input.turnId,
      input: inputText(input.prompt)
    });
  }

  async interruptTurn(input: { threadId: string; turnId: string }) {
    await this.request("turn/interrupt", {
      threadId: input.threadId,
      turnId: input.turnId
    });
  }

  async forkThread(input: ForkThreadInput): Promise<AdapterThread> {
    const result = asRecord(
      await this.request("thread/fork", {
        threadId: input.sourceThreadId,
        cwd: input.cwd,
        model: input.model ?? undefined,
        excludeTurns: true
      })
    );
    return normalizeThread(result.thread);
  }

  async setGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }) {
    const result = asRecord(
      await this.request("thread/goal/set", {
        threadId: input.threadId,
        objective: input.objective,
        status: "active",
        tokenBudget: input.tokenBudget ?? null
      })
    );
    return this.normalizeGoal(result.goal);
  }

  async getGoal(threadId: string) {
    const result = asRecord(await this.request("thread/goal/get", { threadId }));
    return result.goal ? this.normalizeGoal(result.goal) : null;
  }

  async clearGoal(threadId: string) {
    await this.request("thread/goal/clear", { threadId });
  }

  async resolveApproval(input: { approvalId: string; adapterRequestId: string | null; approved: boolean }) {
    const id = input.adapterRequestId;
    if (!id) {
      return;
    }
    this.send({
      id,
      result: {
        decision: input.approved ? "accept" : "decline"
      }
    });
  }

  async close() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("app-server adapter closed"));
    }
    this.pending.clear();
    this.stdout?.close();
    this.process?.kill("SIGTERM");
    this.process = null;
    this.stdout = null;
    this.initialized = false;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureStarted();
    const id = this.nextId++;
    this.send({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`app-server request timed out: ${method}`));
        }
      }, 60_000);
    });
  }

  private async ensureStarted() {
    if (this.initialized) {
      return;
    }
    if (!this.process) {
      this.process = spawn(this.command, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
      this.stdout = createInterface({ input: this.process.stdout });
      this.stdout.on("line", (line) => this.handleLine(line));
      this.process.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) {
          this.emitRaw("app-server/stderr", { text });
        }
      });
      this.process.on("exit", (code, signal) => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error(`app-server exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
        }
        this.pending.clear();
        this.initialized = false;
      });
    }
    await this.initialize();
  }

  private async initialize() {
    const id = this.nextId++;
    this.send({
      id,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex-xyz",
          title: "codex-xyz",
          version: "0.1.0"
        },
        capabilities: null
      }
    });
    await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error("app-server initialize timed out"));
        }
      }, 30_000);
    });
    this.send({ method: "initialized" });
    this.initialized = true;
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.emitRaw("app-server/unparsed", { line: trimmed });
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)));
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
    if (message.method === "item/agentMessage/delta" && threadId && turnId) {
      this.eventHandler({
        type: "item.delta",
        threadId,
        turnId,
        itemId: String(params.itemId),
        delta: String(params.delta ?? "")
      });
      return;
    }
    if (message.method === "turn/completed" && threadId) {
      const turnPayload = asRecord(params.turn);
      const turn = normalizeTurn(turnPayload);
      const durationMs = turnPayload.durationMs;
      this.eventHandler({
        type: "turn.status",
        threadId,
        turnId: turn.id,
        status: turn.status,
        durationMs: typeof durationMs === "number" ? durationMs : null
      });
      return;
    }
    if (message.method === "thread/status/changed" && threadId) {
      this.eventHandler({
        type: "thread.status",
        threadId,
        status: this.normalizeStatus(params.status)
      });
      return;
    }
    this.emitRaw(message.method ?? "notification", params, threadId, turnId);
  }

  private handleServerRequest(message: JsonRpcMessage) {
    const params = asRecord(message.params);
    const threadId = extractThreadId(params);
    const turnId = extractTurnId(params);
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval" ||
      message.method === "item/permissions/requestApproval"
    ) {
      this.eventHandler({
        type: "approval.requested",
        adapterRequestId: String(message.id),
        threadId: threadId ?? "unknown",
        turnId,
        kind:
          message.method === "item/fileChange/requestApproval"
            ? "file"
            : message.method === "item/permissions/requestApproval"
              ? "permissions"
              : "command",
        summary: String(params.command ?? params.reason ?? params.grantRoot ?? "Codex requested approval")
      });
      return;
    }
    this.emitRaw(message.method ?? "serverRequest", params, threadId, turnId);
  }

  private normalizeStatus(value: unknown) {
    const status = asRecord(value);
    if (status.type === "active") {
      return "running";
    }
    if (status.type === "idle") {
      return "idle";
    }
    if (status.type === "systemError") {
      return "failed";
    }
    return "idle";
  }

  private normalizeGoal(value: unknown): AdapterGoal {
    const goal = asRecord(value);
    const status = String(goal.status ?? "active");
    return {
      objective: String(goal.objective ?? ""),
      status: status === "complete" ? "complete" : status === "blocked" ? "blocked" : "in_progress",
      tokenBudget: typeof goal.tokenBudget === "number" ? goal.tokenBudget : null,
      tokensUsed: typeof goal.tokensUsed === "number" ? goal.tokensUsed : 0
    };
  }

  private emitRaw(
    method: string,
    payload: Record<string, unknown>,
    threadId: string | null = null,
    turnId: string | null = null
  ) {
    this.eventHandler({
      type: "raw",
      method,
      threadId,
      turnId,
      payload
    } satisfies AdapterEvent);
  }

  private send(message: JsonRpcMessage) {
    if (!this.process) {
      throw new Error("app-server process is not started");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
