import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface, type Interface } from "node:readline";
import {
  type AdapterEvent,
  type AdapterEventHandler,
  type AdapterThread,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type RunShellCommandInput,
  type ResumeThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "./adapter.js";
import {
  appServerInitializeParams,
  asRecord,
  clampDebugLogLevel,
  debugRecordLevel,
  extractThreadId,
  extractTurnId,
  inputText,
  isYoloApprovalRequest,
  normalizeGoal,
  normalizeThread,
  normalizeThreadId,
  normalizeTurn,
  projectAppServerNotification,
  projectTurnStartedNotification,
  requestError,
  yoloApprovalResponse,
  yoloThreadOptions,
  yoloTurnOptions,
  type AppServerDebugLogLevel,
  type JsonRpcMessage
} from "./appServerProtocol.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  params: unknown;
  timeout: NodeJS.Timeout;
};

type PendingTurnStart = {
  prompt: string;
  resolve: (turn: AdapterTurn) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingTurnStartHandle = {
  promise: Promise<AdapterTurn>;
  cancel: (error: Error) => void;
};

export type AppServerCodexAdapterOptions = {
  debugLogPath?: string | null;
  debugLogLevel?: number | null;
};

class AppServerDebugLogger {
  private disabled = false;

  constructor(
    private readonly filePath: string,
    private readonly level: AppServerDebugLogLevel
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
  private readonly pendingTurnStarts = new Map<string, PendingTurnStart[]>();
  private eventHandler: AdapterEventHandler = () => {};
  private initialized = false;
  private readonly debugLogger: AppServerDebugLogger | null;

  constructor(
    private readonly command = process.env.CODEX_XYZ_CODEX_BIN ?? "codex",
    options: AppServerCodexAdapterOptions = {}
  ) {
    const debugLogLevel = clampDebugLogLevel(options.debugLogLevel ?? 1);
    this.debugLogger =
      options.debugLogPath && debugLogLevel > 0 ? new AppServerDebugLogger(options.debugLogPath, debugLogLevel) : null;
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

  async runShellCommand(input: RunShellCommandInput): Promise<AdapterTurn> {
    const command = input.command.trim();
    if (!command) {
      throw new Error("Shell command must not be empty");
    }

    if (input.activeTurnId) {
      await this.request("thread/shellCommand", {
        threadId: input.threadId,
        command
      });
      return {
        id: input.activeTurnId,
        status: "running"
      };
    }

    const turnStarted = this.waitForTurnStart(input.threadId, `!${command}`, "thread/shellCommand did not start a turn");
    try {
      await this.request("thread/shellCommand", {
        threadId: input.threadId,
        command
      });
      return await turnStarted.promise;
    } catch (error) {
      turnStarted.cancel(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
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

  async renameThread(input: { threadId: string; title: string }) {
    await this.request("thread/name/set", {
      threadId: input.threadId,
      name: input.title
    });
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
    return normalizeGoal(result.goal);
  }

  async setGoalStatus(input: { threadId: string; status: "active" | "paused" | "complete" }) {
    const result = asRecord(
      await this.request("thread/goal/set", {
        threadId: input.threadId,
        status: input.status
      })
    );
    return normalizeGoal(result.goal);
  }

  async startGoal(input: { threadId: string; objective: string; tokenBudget?: number | null }) {
    const turnStarted = this.waitForTurnStart(input.threadId, "", "thread/goal/set did not start a turn");
    try {
      const goal = await this.setGoal(input);
      const turn = await turnStarted.promise;
      return { goal, turn };
    } catch (error) {
      turnStarted.cancel(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async getGoal(threadId: string) {
    const result = asRecord(await this.request("thread/goal/get", { threadId }));
    return result.goal ? normalizeGoal(result.goal) : null;
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
    for (const pending of this.pendingTurnStarts.values()) {
      for (const turnStart of pending) {
        clearTimeout(turnStart.timeout);
        turnStart.reject(new Error("app-server adapter closed"));
      }
    }
    this.pendingTurnStarts.clear();
    this.stdout?.close();
    this.process?.kill("SIGTERM");
    this.process = null;
    this.stdout = null;
    this.initialized = false;
  }

  private waitForTurnStart(threadId: string, prompt: string, timeoutMessage: string): PendingTurnStartHandle {
    const key = normalizeThreadId(threadId);
    let entry: PendingTurnStart | null = null;
    const promise = new Promise<AdapterTurn>((resolve, reject) => {
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
        timeout
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
      }
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

  private resolvePendingTurnStart(threadId: string, turn: AdapterTurn) {
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
        const exitError = new Error(`app-server exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(exitError);
        }
        this.pending.clear();
        for (const pending of this.pendingTurnStarts.values()) {
          for (const turnStart of pending) {
            clearTimeout(turnStart.timeout);
            turnStart.reject(exitError);
          }
        }
        this.pendingTurnStarts.clear();
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
    const params = appServerInitializeParams;
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

    if (message.method === "turn/started" && threadId) {
      const turn = normalizeTurn(asRecord(params.turn));
      const prompt = this.resolvePendingTurnStart(threadId, turn);
      const event = projectTurnStartedNotification(params, prompt);
      if (event) {
        this.eventHandler(event);
      }
      return;
    }

    const event = projectAppServerNotification(message.method ?? "notification", params);
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

  private acceptYoloRequest(message: JsonRpcMessage, params: Record<string, unknown>) {
    this.send({
      id: message.id,
      result: yoloApprovalResponse(message.method, params)
    });
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
