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
  type AdapterTokenUsage,
  type AdapterTurn,
  type CodexAdapter,
  type ForkThreadInput,
  type RunShellCommandInput,
  type ResumeThreadInput,
  type StartThreadInput,
  type StartTurnAdapterInput
} from "./adapter.js";
import type { RuntimeStatus } from "../domain.js";

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

type AppServerDebugLogLevel = 0 | 1 | 2 | 3;

const yoloThreadOptions = {
  approvalPolicy: "never",
  sandbox: "danger-full-access"
} as const;

const yoloTurnOptions = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} as const;

const highVolumeDebugMethods = new Set([
  "command/exec/outputDelta",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "process/outputDelta",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/transcript/delta"
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clampDebugLogLevel(value: unknown): AppServerDebugLogLevel {
  const level = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(3, Math.max(0, level)) as AppServerDebugLogLevel;
}

function debugMessageMethod(record: Record<string, unknown>) {
  const message = asRecord(record.message);
  return typeof message.method === "string" ? message.method : null;
}

function debugRecordLevel(record: Record<string, unknown>): AppServerDebugLogLevel {
  if (record.event === "message") {
    if (record.parsed === false) {
      return 1;
    }
    const method = debugMessageMethod(record);
    return method && highVolumeDebugMethods.has(method) ? 3 : 2;
  }
  return 1;
}

function inputText(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function textFromUserInput(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  const parts = entries.map((entry) => {
    const item = asRecord(entry);
    if (item.type === "text") {
      return typeof item.text === "string" ? item.text : "";
    }
    if (item.type === "image") {
      return `[image] ${String(item.url ?? "")}`.trim();
    }
    if (item.type === "localImage") {
      return `[image] ${String(item.path ?? "")}`.trim();
    }
    if (item.type === "skill") {
      return `[skill] ${String(item.name ?? "")}`.trim();
    }
    if (item.type === "mention") {
      return `[mention] ${String(item.name ?? item.path ?? "")}`.trim();
    }
    return "";
  });
  return parts.filter(Boolean).join("\n");
}

function fileChangeSummary(changes: unknown) {
  if (!Array.isArray(changes)) {
    return "";
  }
  return changes
    .map((change) => {
      const record = asRecord(change);
      const kind = asRecord(record.kind);
      const path = String(record.path ?? "");
      const action = typeof kind.type === "string" ? kind.type : "update";
      const target = kind.move_path ? `${path} -> ${String(kind.move_path)}` : path;
      return `${action}: ${target}`;
    })
    .filter(Boolean)
    .join("\n");
}

function fileChangeText(changes: unknown) {
  if (!Array.isArray(changes)) {
    return "";
  }
  const sections = changes.map((change) => {
    const record = asRecord(change);
    const summary = fileChangeSummary([record]);
    const diff = typeof record.diff === "string" && record.diff ? `\n${record.diff}` : "";
    return `${summary}${diff}`.trim();
  });
  return sections.filter(Boolean).join("\n\n");
}

function planText(explanation: unknown, plan: unknown) {
  const heading = typeof explanation === "string" && explanation.trim() ? `${explanation.trim()}\n` : "";
  const steps = Array.isArray(plan)
    ? plan
        .map((step, index) => {
          const record = asRecord(step);
          const status = typeof record.status === "string" ? record.status : "pending";
          return `${index + 1}. [${status}] ${String(record.step ?? "")}`.trim();
        })
        .filter(Boolean)
    : [];
  return `${heading}${steps.join("\n")}`.trim();
}

function normalizeThreadItem(value: unknown) {
  const item = asRecord(value);
  const id = String(item.id ?? "");
  const itemType = String(item.type ?? "system");
  if (itemType === "userMessage") {
    return {
      itemId: id,
      itemType: "user" as const,
      text: textFromUserInput(item.content),
      data: { sourceType: itemType, clientId: item.clientId ?? null, raw: item }
    };
  }
  if (itemType === "agentMessage") {
    return {
      itemId: id,
      itemType: "agent" as const,
      text: String(item.text ?? ""),
      data: { sourceType: itemType, phase: item.phase ?? null, raw: item }
    };
  }
  if (itemType === "plan") {
    return {
      itemId: id,
      itemType: "plan" as const,
      text: String(item.text ?? ""),
      data: { sourceType: itemType, raw: item }
    };
  }
  if (itemType === "commandExecution") {
    return {
      itemId: id,
      itemType: "command" as const,
      text: formatCommandExecution(item),
      data: {
        sourceType: itemType,
        command: item.command ?? null,
        cwd: item.cwd ?? null,
        status: item.status ?? null,
        source: item.source ?? null,
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
        raw: item
      }
    };
  }
  if (itemType === "fileChange") {
    return {
      itemId: id,
      itemType: "file" as const,
      text: fileChangeText(item.changes) || fileChangeSummary(item.changes),
      data: {
        sourceType: itemType,
        status: item.status ?? null,
        changes: Array.isArray(item.changes) ? item.changes : [],
        raw: item
      }
    };
  }
  if (itemType === "reasoning") {
    const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
    const content = Array.isArray(item.content) ? item.content.join("\n") : "";
    return {
      itemId: id,
      itemType: "plan" as const,
      text: [summary, content].filter(Boolean).join("\n\n"),
      data: { sourceType: itemType, raw: item }
    };
  }
  if (itemType === "mcpToolCall") {
    return {
      itemId: id,
      itemType: "system" as const,
      text: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")} ${String(item.status ?? "")}`.trim(),
      data: { sourceType: itemType, raw: item }
    };
  }
  if (itemType === "dynamicToolCall") {
    return {
      itemId: id,
      itemType: "system" as const,
      text: `${String(item.namespace ?? "tool")}.${String(item.tool ?? "call")} ${String(item.status ?? "")}`.trim(),
      data: { sourceType: itemType, raw: item }
    };
  }
  if (itemType === "webSearch") {
    return {
      itemId: id,
      itemType: "system" as const,
      text: `Web search: ${String(item.query ?? "")}`.trim(),
      data: { sourceType: itemType, raw: item }
    };
  }
  return {
    itemId: id,
    itemType: "system" as const,
    text: itemType,
    data: { sourceType: itemType, raw: item }
  };
}

function normalizeThreadId(value: unknown) {
  const id = String(value);
  const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  const prefixed = id.match(new RegExp(`^thread_(${uuid})$`));
  const urn = id.match(new RegExp(`^urn:uuid:(${uuid})$`, "i"));
  return (prefixed?.[1] ?? urn?.[1] ?? id).toLowerCase();
}

function normalizeRuntimeStatus(value: unknown): RuntimeStatus {
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
  if (status.type === "notLoaded") {
    return "stale";
  }
  const text = typeof value === "string" ? value : typeof status.status === "string" ? status.status : "";
  if (
    text === "idle" ||
    text === "running" ||
    text === "stale" ||
    text === "interrupted" ||
    text === "failed" ||
    text === "completed"
  ) {
    return text;
  }
  return "idle";
}

function normalizeOptionalTurnId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeThread(value: unknown, model?: unknown): AdapterThread {
  const thread = asRecord(value);
  const id = normalizeThreadId(thread.id);
  const status = asRecord(thread.status);
  return {
    id,
    sessionId: normalizeThreadId(thread.sessionId ?? id),
    forkedFromId: typeof thread.forkedFromId === "string" ? normalizeThreadId(thread.forkedFromId) : null,
    preview: String(thread.preview ?? ""),
    cwd: String(thread.cwd ?? process.cwd()),
    model: typeof thread.model === "string" ? thread.model : typeof model === "string" ? model : null,
    status: normalizeRuntimeStatus(thread.status),
    activeTurnId:
      normalizeOptionalTurnId(thread.activeTurnId) ??
      normalizeOptionalTurnId(status.activeTurnId) ??
      normalizeOptionalTurnId(status.turnId)
  };
}

function normalizeTurn(value: unknown): AdapterTurn {
  const turn = asRecord(value);
  const status = String(turn.status ?? "running");
  return {
    id: String(turn.id),
    status:
      status === "completed"
        ? "completed"
        : status === "interrupted"
          ? "interrupted"
          : status === "failed"
            ? "failed"
            : "running"
  };
}

function extractThreadId(params: Record<string, unknown>) {
  return typeof params.threadId === "string" ? normalizeThreadId(params.threadId) : null;
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

function formatCommandExecution(item: Record<string, unknown>) {
  const command = String(item.command ?? "");
  const status = String(item.status ?? "inProgress");
  const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
  const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
  let text = `$ ${command}\n${output}`;
  if (status !== "inProgress") {
    const exit = exitCode === null ? status : `${status}, exit ${exitCode}`;
    text = `${text.endsWith("\n") ? text : `${text}\n`}[${exit}]`;
  }
  return text;
}

function normalizeTokenUsage(value: unknown): AdapterTokenUsage {
  const usage = asRecord(value);
  const total = asRecord(usage.total);
  return {
    totalTokens: typeof total.totalTokens === "number" ? total.totalTokens : 0,
    inputTokens: typeof total.inputTokens === "number" ? total.inputTokens : 0,
    cachedInputTokens: typeof total.cachedInputTokens === "number" ? total.cachedInputTokens : 0,
    outputTokens: typeof total.outputTokens === "number" ? total.outputTokens : 0,
    reasoningOutputTokens: typeof total.reasoningOutputTokens === "number" ? total.reasoningOutputTokens : 0,
    modelContextWindow: typeof usage.modelContextWindow === "number" ? usage.modelContextWindow : null
  };
}

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
    return this.normalizeGoal(result.goal);
  }

  async setGoalStatus(input: { threadId: string; status: "active" | "paused" | "complete" }) {
    const result = asRecord(
      await this.request("thread/goal/set", {
        threadId: input.threadId,
        status: input.status
      })
    );
    return this.normalizeGoal(result.goal);
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

    if (message.method === "turn/started" && threadId) {
      const turn = normalizeTurn(asRecord(params.turn));
      const prompt = this.resolvePendingTurnStart(threadId, turn);
      this.eventHandler({
        type: "turn.started",
        threadId,
        turnId: turn.id,
        prompt: prompt ?? ""
      });
      return;
    }

    if (message.method === "item/agentMessage/delta" && threadId && turnId) {
      this.eventHandler({
        type: "item.delta",
        threadId,
        turnId,
        itemId: String(params.itemId),
        delta: String(params.delta ?? ""),
        itemType: "agent"
      });
      return;
    }
    if (message.method === "item/plan/delta" && threadId && turnId) {
      this.eventHandler({
        type: "item.delta",
        threadId,
        turnId,
        itemId: String(params.itemId),
        delta: String(params.delta ?? ""),
        itemType: "plan"
      });
      return;
    }
    if (message.method === "item/commandExecution/outputDelta" && threadId && turnId) {
      this.eventHandler({
        type: "item.delta",
        threadId,
        turnId,
        itemId: String(params.itemId),
        delta: String(params.delta ?? ""),
        itemType: "command"
      });
      return;
    }
    if (message.method === "item/fileChange/outputDelta" && threadId && turnId) {
      this.eventHandler({
        type: "item.delta",
        threadId,
        turnId,
        itemId: String(params.itemId),
        delta: String(params.delta ?? ""),
        itemType: "file"
      });
      return;
    }
    if ((message.method === "item/started" || message.method === "item/completed") && threadId && turnId) {
      const item = normalizeThreadItem(params.item);
      if (item.itemId) {
        this.eventHandler({
          type: message.method === "item/started" ? "item.created" : "item.updated",
          threadId,
          turnId,
          itemId: item.itemId,
          itemType: item.itemType,
          text: item.text,
          data: item.data
        });
        return;
      }
    }
    if (message.method === "item/fileChange/patchUpdated" && threadId && turnId) {
      const itemId = String(params.itemId ?? "");
      if (itemId) {
        this.eventHandler({
          type: "item.updated",
          threadId,
          turnId,
          itemId,
          itemType: "file",
          text: fileChangeText(params.changes) || fileChangeSummary(params.changes),
          data: {
            sourceType: "fileChange",
            changes: Array.isArray(params.changes) ? params.changes : [],
            patchUpdated: true
          }
        });
        return;
      }
    }
    if (message.method === "turn/plan/updated" && threadId && turnId) {
      this.eventHandler({
        type: "item.updated",
        threadId,
        turnId,
        itemId: `plan_${turnId}`,
        itemType: "plan",
        text: planText(params.explanation, params.plan),
        data: {
          sourceType: "turnPlan",
          explanation: params.explanation ?? null,
          plan: Array.isArray(params.plan) ? params.plan : []
        }
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
    if (message.method === "thread/goal/updated" && threadId) {
      this.eventHandler({
        type: "thread.goal",
        threadId,
        turnId,
        goal: this.normalizeGoal(asRecord(params.goal))
      });
      return;
    }
    if (message.method === "thread/goal/cleared" && threadId) {
      this.eventHandler({
        type: "thread.goal",
        threadId,
        turnId: null,
        goal: null
      });
      return;
    }
    if (message.method === "thread/name/updated" && threadId) {
      this.eventHandler({
        type: "thread.renamed",
        threadId,
        title: typeof params.threadName === "string" ? params.threadName : null
      });
      return;
    }
    if (message.method === "thread/tokenUsage/updated" && threadId) {
      this.eventHandler({
        type: "thread.token_usage",
        threadId,
        turnId,
        usage: normalizeTokenUsage(params.tokenUsage)
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
    return normalizeRuntimeStatus(value);
  }

  private normalizeGoal(value: unknown): AdapterGoal {
    const goal = asRecord(value);
    const status = String(goal.status ?? "active");
    return {
      objective: String(goal.objective ?? ""),
      status:
        status === "complete"
          ? "complete"
          : status === "paused"
            ? "paused"
            : status === "blocked"
              ? "blocked"
              : status === "usageLimited"
                ? "usage_limited"
                : status === "budgetLimited"
                  ? "budget_limited"
                  : "in_progress",
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
