import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { extname, join, normalize } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ControlService } from "./service.js";
import { isSummaryEventType, type TerminalEvent } from "./domain.js";

type HandlerContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service: ControlService;
};

type HttpServerOptions = {
  clientDistDir?: string | null;
  corsOrigin?: string | null;
  corsOrigins?: readonly string[] | null;
};

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const terminalBackpressureHighWater = 512 * 1024;
const terminalBackpressureLowWater = 128 * 1024;
const terminalDrainCheckMs = 25;

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function sendNoContent(response: ServerResponse) {
  response.writeHead(204);
  response.end();
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
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

function optionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
  return url.pathname.split("/").filter(Boolean);
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

function writeSse(response: ServerResponse, event: string, data: unknown, id?: number) {
  response.write(formatSse(event, data, id));
}

class TerminalSseConnection {
  private readonly pauseToken = Symbol("terminal-sse");
  private readonly queue: string[] = [];
  private queuedBytes = 0;
  private waitingForDrain = false;
  private paused = false;
  private closed = false;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private readonly response: ServerResponse,
    private readonly service: ControlService
  ) {
    this.heartbeat = setInterval(() => {
      this.enqueue(": ping\n\n");
    }, 25_000);
  }

  send(event: TerminalEvent) {
    this.enqueue(formatSse(event.type, event, event.sequence));
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeat);
    this.resumeTerminal();
    this.queue.length = 0;
    this.queuedBytes = 0;
  }

  private enqueue(payload: string) {
    if (this.closed) {
      return;
    }
    this.queue.push(payload);
    this.queuedBytes += Buffer.byteLength(payload, "utf8");
    this.updateBackpressure();
    this.flush();
  }

  private flush() {
    if (this.closed || this.waitingForDrain) {
      return;
    }
    while (this.queue.length > 0) {
      const payload = this.queue.shift();
      if (!payload) {
        break;
      }
      this.queuedBytes -= Buffer.byteLength(payload, "utf8");
      const canContinue = this.response.write(payload);
      if (!canContinue) {
        this.waitingForDrain = true;
        this.response.once("drain", () => {
          this.waitingForDrain = false;
          this.updateBackpressure();
          this.flush();
        });
        break;
      }
    }
    this.updateBackpressure();
  }

  private updateBackpressure() {
    const bufferedBytes = this.queuedBytes + this.response.writableLength;
    if (bufferedBytes >= terminalBackpressureHighWater) {
      this.pauseTerminal();
      return;
    }
    if (bufferedBytes <= terminalBackpressureLowWater) {
      this.resumeTerminal();
    }
  }

  private pauseTerminal() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.service.terminal.pauseOutput(this.pauseToken);
  }

  private resumeTerminal() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.service.terminal.resumeOutput(this.pauseToken);
  }
}

function rawDataToString(data: RawData) {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function optionalSocketDimension(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function handleTerminalSocketMessage(service: ControlService, data: RawData) {
  const message = JSON.parse(rawDataToString(data)) as Record<string, unknown>;
  if (message.type === "terminal.input") {
    const input = message.data;
    if (typeof input === "string" && input.length > 0) {
      service.terminal.write(input);
    }
    return;
  }
  if (message.type === "terminal.resize") {
    void service.terminal.resize({
      cols: optionalSocketDimension(message.cols),
      rows: optionalSocketDimension(message.rows)
    });
  }
}

function handleTerminalWebSocket(service: ControlService, socket: WebSocket, url: URL) {
  const pauseToken = Symbol("terminal-ws");
  const after = Number(url.searchParams.get("after") ?? 0);
  let paused = false;
  let closed = false;
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  const replayAfter = Number.isFinite(after) ? after : 0;

  const pauseTerminal = () => {
    if (paused) {
      return;
    }
    paused = true;
    service.terminal.pauseOutput(pauseToken);
    if (!drainTimer) {
      drainTimer = setInterval(updateBackpressure, terminalDrainCheckMs);
    }
  };

  const resumeTerminal = () => {
    if (!paused) {
      return;
    }
    paused = false;
    service.terminal.resumeOutput(pauseToken);
    if (drainTimer) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
  };

  function updateBackpressure() {
    if (closed || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (socket.bufferedAmount >= terminalBackpressureHighWater) {
      pauseTerminal();
      return;
    }
    if (socket.bufferedAmount <= terminalBackpressureLowWater) {
      resumeTerminal();
    }
  }

  const send = (event: TerminalEvent) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(event), (error) => {
      if (error) {
        socket.close();
        return;
      }
      updateBackpressure();
    });
    updateBackpressure();
  };

  for (const event of service.terminal.replay(replayAfter)) {
    send(event);
  }
  const unsubscribe = service.terminal.subscribe(send);
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }, 25_000);

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    if (drainTimer) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
    unsubscribe();
    resumeTerminal();
  };

  socket.on("message", (data) => {
    try {
      handleTerminalSocketMessage(service, data);
    } catch {
      socket.close();
    }
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

async function handleApi(context: HandlerContext) {
  const { request, response, service, url } = context;
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      adapter: service.adapter.name
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, service.dashboard());
    return true;
  }

  if (method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const after = Number(url.searchParams.get("after") ?? 0);
    for (const event of service.replayEvents(Number.isFinite(after) ? after : 0, { summaryOnly: true })) {
      writeSse(response, event.type, event, event.id);
    }
    const unsubscribe = service.events.subscribe((event) => {
      if (isSummaryEventType(event.type)) {
        writeSse(response, event.type, event, event.id);
      }
    });
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 25_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/terminal") {
    sendJson(response, 200, await service.terminal.snapshot());
    return true;
  }

  if (method === "GET" && url.pathname === "/api/terminal/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const after = Number(url.searchParams.get("after") ?? 0);
    const terminalSse = new TerminalSseConnection(response, service);
    for (const event of service.terminal.replay(Number.isFinite(after) ? after : 0)) {
      terminalSse.send(event);
    }
    const unsubscribe = service.terminal.subscribe((event) => terminalSse.send(event));
    request.on("close", () => {
      terminalSse.close();
      unsubscribe();
    });
    return true;
  }

  const parts = pathParts(url);
  const route = parts.join("/");

  if (method === "POST" && route === "api/terminal/start") {
    const body = await readJson(request);
    const snapshot = await service.terminal.start({
      cols: optionalPositiveInteger(body, "cols"),
      rows: optionalPositiveInteger(body, "rows")
    });
    sendJson(response, 200, snapshot);
    return true;
  }

  if (method === "POST" && route === "api/terminal/input") {
    const body = await readJson(request);
    const data = requireRawString(body, "data");
    if (data.length > 0) {
      service.terminal.write(data);
    }
    sendNoContent(response);
    return true;
  }

  if (method === "POST" && route === "api/terminal/resize") {
    const body = await readJson(request);
    sendJson(
      response,
      200,
      await service.terminal.resize({
        cols: optionalPositiveInteger(body, "cols"),
        rows: optionalPositiveInteger(body, "rows")
      })
    );
    return true;
  }

  if (method === "POST" && route === "api/terminal/terminate") {
    sendJson(response, 200, await service.terminal.terminate());
    return true;
  }

  if (method === "GET" && route === "api/projects") {
    sendJson(response, 200, service.listProjects());
    return true;
  }

  if (method === "POST" && route === "api/projects") {
    const body = await readJson(request);
    const project = service.createProject({
      name: optionalString(body, "name"),
      path: requireString(body, "path")
    });
    sendJson(response, 201, project);
    return true;
  }

  if (method === "GET" && route === "api/tasks") {
    sendJson(response, 200, service.listTasks());
    return true;
  }

  if (method === "POST" && route === "api/tasks") {
    const body = await readJson(request);
    const result = await service.createTask({
      projectId: requireString(body, "projectId"),
      prompt: requireString(body, "prompt"),
      goalMode: optionalBoolean(body, "goalMode"),
      title: optionalString(body, "title"),
      recipeId: optionalString(body, "recipeId"),
      model: optionalString(body, "model")
    });
    sendJson(response, 201, result);
    return true;
  }

  if (method === "GET" && route === "api/threads") {
    if (url.searchParams.has("limit") || url.searchParams.has("offset")) {
      sendJson(
        response,
        200,
        service.listThreadPage({
          limit: optionalQueryInteger(url, "limit", { min: 1 }),
          offset: optionalQueryInteger(url, "offset", { min: 0 })
        })
      );
      return true;
    }
    sendJson(response, 200, service.listThreads());
    return true;
  }

  if (parts[0] === "api" && parts[1] === "threads" && parts[2]) {
    const threadId = parts[2];
    if (method === "GET" && parts.length === 3) {
      sendJson(response, 200, service.getThreadDetail(threadId));
      return true;
    }

    if (method === "GET" && parts[3] === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const after = Number(url.searchParams.get("after") ?? 0);
      for (const event of service.replayEvents(Number.isFinite(after) ? after : 0, { threadId })) {
        writeSse(response, event.type, event, event.id);
      }
      const unsubscribe = service.events.subscribe((event) => {
        if (event.threadId === threadId) {
          writeSse(response, event.type, event, event.id);
        }
      });
      const heartbeat = setInterval(() => {
        response.write(": ping\n\n");
      }, 25_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return true;
    }

    if (method === "POST" && parts[3] === "turns") {
      const body = await readJson(request);
      const turn = await service.startTurn({
        threadId,
        prompt: requireString(body, "prompt"),
        model: optionalString(body, "model")
      });
      sendJson(response, 201, turn);
      return true;
    }

    if (method === "POST" && parts[3] === "resume") {
      const thread = await service.resumeThread(threadId);
      sendJson(response, 200, thread);
      return true;
    }

    if (method === "PUT" && parts[3] === "name") {
      const body = await readJson(request);
      const thread = await service.renameThread({
        threadId,
        title: requireString(body, "title")
      });
      sendJson(response, 200, thread);
      return true;
    }

    if (method === "POST" && parts[3] === "steer") {
      const body = await readJson(request);
      await service.steerTurn(threadId, requireString(body, "prompt"));
      sendNoContent(response);
      return true;
    }

    if (method === "POST" && parts[3] === "queue") {
      const body = await readJson(request);
      const queuedPrompts = await service.queueTurn(threadId, requireString(body, "prompt"));
      sendJson(response, 201, queuedPrompts);
      return true;
    }

    if (method === "POST" && parts[3] === "interrupt") {
      const thread = await service.interruptTurn(threadId);
      sendJson(response, 200, thread);
      return true;
    }

    if (method === "POST" && parts[3] === "fork") {
      const thread = await service.forkThread(threadId);
      sendJson(response, 201, thread);
      return true;
    }

    if (parts[3] === "goal") {
      if (method === "GET") {
        sendJson(response, 200, await service.getGoal(threadId));
        return true;
      }
      if (method === "PUT") {
        const body = await readJson(request);
        const goalStart = await service.startGoal({
          threadId,
          objective: requireString(body, "objective"),
          tokenBudget: optionalPositiveInteger(body, "tokenBudget")
        });
        sendJson(response, 200, goalStart);
        return true;
      }
      if (method === "DELETE") {
        sendJson(response, 200, await service.clearGoal(threadId));
        return true;
      }
    }
  }

  return false;
}

function normalizeCorsOrigins(options: HttpServerOptions) {
  return [
    ...new Set([
      ...(options.corsOrigin ? [options.corsOrigin] : []),
      ...(options.corsOrigins ?? [])
    ])
  ];
}

function allowedCorsOrigin(requestOrigin: string | undefined, corsOrigins: readonly string[]) {
  if (!requestOrigin || !corsOrigins.includes(requestOrigin)) {
    return null;
  }
  return requestOrigin;
}

function applyCorsHeaders(response: ServerResponse, requestOrigin: string | undefined, corsOrigins: readonly string[]) {
  const origin = allowedCorsOrigin(requestOrigin, corsOrigins);
  if (!origin) {
    return;
  }
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("vary", "Origin");
}

function serveStatic(response: ServerResponse, url: URL, clientDistDir: string | null) {
  if (!clientDistDir || !existsSync(clientDistDir)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(clientDistDir, normalized);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(clientDistDir, "index.html");
  }
  const ext = extname(filePath);
  response.writeHead(200, {
    "content-type": mimeTypes[ext] ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

function rejectUpgrade(socket: Duplex, statusCode: number) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusCode === 403 ? "Forbidden" : "Not Found"}\r\n\r\n`);
  socket.destroy();
}

export function createHttpServer(service: ControlService, options: HttpServerOptions = {}) {
  const corsOrigins = normalizeCorsOrigins(options);
  const terminalWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  });
  terminalWebSocketServer.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    handleTerminalWebSocket(service, socket, url);
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    applyCorsHeaders(response, request.headers.origin, corsOrigins);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (request.method === "OPTIONS") {
          response.writeHead(204);
          response.end();
          return;
        }
        const handled = await handleApi({ request, response, url, service });
        if (!handled) {
          sendJson(response, 404, { error: "Not found" });
        }
        return;
      }
      serveStatic(response, url, options.clientDistDir ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(response, 400, { error: message });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (url.pathname !== "/api/terminal/ws") {
      rejectUpgrade(socket, 404);
      return;
    }
    if (corsOrigins.length > 0 && request.headers.origin && !allowedCorsOrigin(request.headers.origin, corsOrigins)) {
      rejectUpgrade(socket, 403);
      return;
    }
    terminalWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      terminalWebSocketServer.emit("connection", webSocket, request);
    });
  });
  server.on("close", () => {
    terminalWebSocketServer.close();
  });
  return server;
}
