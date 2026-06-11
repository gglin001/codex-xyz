import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  AdapterThreadNotFoundError,
  type AdapterEvent,
  type AdapterEventHandler,
  type AdapterGoal,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type ResumeThreadInput,
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
  method: string;
  params: unknown;
  timeout: NodeJS.Timeout;
};

export type AppServerCodexAdapterOptions = {
  debugLogPath?: string | null;
};

const yoloThreadOptions = {
  approvalPolicy: "never",
  sandbox: "danger-full-access"
} as const;

const yoloTurnOptions = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function inputText(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function normalizeThreadId(value: unknown) {
  const id = String(value);
  const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  const prefixed = id.match(new RegExp(`^thread_(${uuid})$`));
  const urn = id.match(new RegExp(`^urn:uuid:(${uuid})$`, "i"));
  return (prefixed?.[1] ?? urn?.[1] ?? id).toLowerCase();
}

function normalizeThread(value: unknown, model?: unknown): AdapterThread {
  const thread = asRecord(value);
  const id = normalizeThreadId(thread.id);
  return {
    id,
    sessionId: normalizeThreadId(thread.sessionId ?? id),
    forkedFromId: typeof thread.forkedFromId === "string" ? normalizeThreadId(thread.forkedFromId) : null,
    preview: String(thread.preview ?? ""),
    cwd: String(thread.cwd ?? process.cwd()),
    model: typeof thread.model === "string" ? thread.model : typeof model === "string" ? model : null
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

function requestError(error: unknown, params: unknown) {
  const payload = asRecord(error);
  const message = typeof payload.message === "string" ? payload.message : JSON.stringify(error);
  if (/thread not found/i.test(message)) {
    const match = message.match(/thread not found:\s*([^\s"}]+)/i);
    const threadId = match?.[1] ?? extractThreadId(asRecord(params));
    if (threadId) {
      return new AdapterThreadNotFoundError(threadId, message);
    }
  }
  return new Error(message);
}

class AppServerDebugLogger {
  private disabled = false;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, "", "utf8");
  }

  write(record: Record<string, unknown>) {
    if (this.disabled) {
      return;
    }
    try {
      appendFileSync(
        this.filePath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          target: "app-server",
          ...record
        })}\n`,
        "utf8"
      );
    } catch {
      this.disabled = true;
    }
  }
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
  private readonly debugLogger: AppServerDebugLogger | null;

  constructor(
    private readonly command = process.env.CODEX_XYZ_CODEX_BIN ?? "codex",
    options: AppServerCodexAdapterOptions = {}
  ) {
    this.debugLogger = options.debugLogPath ? new AppServerDebugLogger(options.debugLogPath) : null;
  }

  onEvent(handler: AdapterEventHandler) {
    this.eventHandler = handler;
  }

  async startThread(input: StartThreadInput): Promise<AdapterThread> {
    const result = asRecord(
      await this.request("thread/start", {
        cwd: input.cwd,
        model: input.model ?? undefined,
        serviceName: "codex-xyz",
        threadSource: "user",
        ...yoloThreadOptions
      })
    );
    return normalizeThread(result.thread, result.model);
  }

  async resumeThread(input: ResumeThreadInput): Promise<AdapterThread> {
    const result = asRecord(
      await this.request("thread/resume", {
        threadId: input.threadId,
        cwd: input.cwd,
        model: input.model ?? undefined,
        excludeTurns: true,
        ...yoloThreadOptions
      })
    );
    return normalizeThread(result.thread, result.model);
  }

  async startTurn(input: StartTurnAdapterInput): Promise<AdapterTurn> {
    const result = asRecord(
      await this.request("turn/start", {
        threadId: input.threadId,
        input: inputText(input.prompt),
        model: input.model ?? undefined,
        ...yoloTurnOptions
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
        excludeTurns: true,
        ...yoloThreadOptions
      })
    );
    return normalizeThread(result.thread, result.model);
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

  async close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
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
    if (this.initialized) {
      return;
    }
    if (!this.process) {
      const child = spawn(this.command, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
      this.writeDebug({
        event: "process.spawn",
        command: this.command,
        args: ["app-server", "--stdio"],
        pid: child.pid ?? null
      });
      this.process = child;
      this.stdout = createInterface({ input: child.stdout });
      this.stdout.on("line", (line) => this.handleLine(line));
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) {
          this.writeDebug({
            event: "stderr",
            direction: "in",
            text
          });
          this.emitRaw("app-server/stderr", { text });
        }
      });
      child.on("exit", (code, signal) => {
        this.writeDebug({
          event: "process.exit",
          code: code ?? null,
          signal: signal ?? null
        });
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`app-server exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
        }
        this.pending.clear();
        if (this.process === child) {
          this.stdout?.close();
          this.process = null;
          this.stdout = null;
          this.initialized = false;
        }
      });
    }
    await this.initialize();
  }

  private async initialize() {
    const id = this.nextId++;
    const params = {
      clientInfo: {
        name: "codex-xyz",
        title: "codex-xyz",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false
      }
    };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error("app-server initialize timed out"));
        }
      }, 30_000);
      this.pending.set(id, { resolve, reject, method: "initialize", params, timeout });
      try {
        this.send({
          id,
          method: "initialize",
          params
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

  private handleLine(line: string) {
    const trimmed = line.trim();
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
        line: trimmed
      });
      this.emitRaw("app-server/unparsed", { line: trimmed });
      return;
    }
    this.writeDebug({
      event: "message",
      direction: "in",
      parsed: true,
      message
    });

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
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
      this.acceptYoloRequest(message, params);
      return;
    }
    this.emitRaw(message.method ?? "serverRequest", params, threadId, turnId);
  }

  private acceptYoloRequest(message: JsonRpcMessage, params: Record<string, unknown>) {
    if (message.method === "item/permissions/requestApproval") {
      this.send({
        id: message.id,
        result: {
          permissions: asRecord(params.permissions),
          scope: "session"
        }
      });
      return;
    }

    this.send({
      id: message.id,
      result: {
        decision: "accept"
      }
    });
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

  private writeDebug(record: Record<string, unknown>) {
    this.debugLogger?.write(record);
  }

  private send(message: JsonRpcMessage) {
    if (!this.process) {
      throw new Error("app-server process is not started");
    }
    this.writeDebug({
      event: "message",
      direction: "out",
      parsed: true,
      message
    });
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
