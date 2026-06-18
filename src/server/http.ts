import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { handleApiRequest } from "./api.js";
import type { TerminalEvent } from "./domain.js";
import type { ControlService } from "./service.js";

type HttpServerOptions = {
  corsOrigin?: string | null;
  corsOrigins?: readonly string[] | null;
};

const terminalBackpressureHighWater = 512 * 1024;
const terminalBackpressureLowWater = 128 * 1024;
const terminalDrainCheckMs = 25;

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

export function handleTerminalWebSocketConnection(service: ControlService, socket: WebSocket, url: URL) {
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

function normalizeCorsOrigins(options: HttpServerOptions) {
  return [
    ...new Set([
      ...(options.corsOrigin ? [options.corsOrigin] : []),
      ...(options.corsOrigins ?? [])
    ])
  ];
}

function effectiveOriginPort(url: URL) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function isWildcardBindHostname(hostname: string) {
  return hostname === "0.0.0.0" || hostname === "[::]";
}

function corsOriginMatches(requestOrigin: string, configuredOrigin: string) {
  if (requestOrigin === configuredOrigin) {
    return true;
  }

  let requestUrl: URL;
  let configuredUrl: URL;
  try {
    requestUrl = new URL(requestOrigin);
    configuredUrl = new URL(configuredOrigin);
  } catch {
    return false;
  }

  return (
    isWildcardBindHostname(configuredUrl.hostname) &&
    requestUrl.protocol === configuredUrl.protocol &&
    effectiveOriginPort(requestUrl) === effectiveOriginPort(configuredUrl)
  );
}

function allowedCorsOrigin(requestOrigin: string | undefined, corsOrigins: readonly string[]) {
  if (!requestOrigin || !corsOrigins.some((origin) => corsOriginMatches(requestOrigin, origin))) {
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

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function rejectUpgrade(socket: Duplex, statusCode: number) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusCode === 403 ? "Forbidden" : "Not Found"}\r\n\r\n`);
  socket.destroy();
}

function requestBodyForWebRequest(request: IncomingMessage) {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      request.on("data", (chunk: Buffer | string) => {
        controller.enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on("end", () => {
        controller.close();
      });
      request.on("error", (error) => {
        controller.error(error);
      });
    },
    cancel() {
      request.destroy();
    }
  });
}

function toWebRequest(request: IncomingMessage, url: URL) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const controller = new AbortController();
  request.on("aborted", () => {
    controller.abort();
  });
  return new Request(url, {
    method: request.method,
    headers,
    body: requestBodyForWebRequest(request),
    signal: controller.signal,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

async function sendWebResponse(response: ServerResponse, webResponse: Response) {
  response.statusCode = webResponse.status;
  response.statusMessage = webResponse.statusText;
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!webResponse.body) {
    response.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        response.end();
        return;
      }
      if (!response.write(Buffer.from(chunk.value))) {
        await new Promise<void>((resolve) => response.once("drain", resolve));
      }
    }
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
  } finally {
    reader.releaseLock();
  }
}

export function createHttpServer(service: ControlService, options: HttpServerOptions = {}) {
  const corsOrigins = normalizeCorsOrigins(options);
  const terminalWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    applyCorsHeaders(response, request.headers.origin, corsOrigins);
    try {
      if (!url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      const webRequest = toWebRequest(request, url);
      const webResponse = await handleApiRequest(service, webRequest);
      await sendWebResponse(response, webResponse ?? Response.json({ error: "Not found" }, { status: 404 }));
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
      handleTerminalWebSocketConnection(service, webSocket, url);
    });
  });
  server.on("close", () => {
    terminalWebSocketServer.close();
  });
  return server;
}
