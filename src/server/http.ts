import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { ControlService } from "./service.js";

type HandlerContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service: ControlService;
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

function optionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pathParts(url: URL) {
  return url.pathname.split("/").filter(Boolean);
}

function writeSse(response: ServerResponse, event: string, data: unknown, id?: number) {
  if (id !== undefined) {
    response.write(`id: ${id}\n`);
  }
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleApi(context: HandlerContext) {
  const { request, response, service, url } = context;
  const method = request.method ?? "GET";
  const parts = pathParts(url);

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
    for (const event of service.replayEvents(Number.isFinite(after) ? after : 0)) {
      writeSse(response, event.type, event, event.id);
    }
    const unsubscribe = service.events.subscribe((event) => writeSse(response, event.type, event, event.id));
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 25_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return true;
  }

  if (method === "GET" && parts.join("/") === "api/projects") {
    sendJson(response, 200, service.listProjects());
    return true;
  }

  if (method === "POST" && parts.join("/") === "api/projects") {
    const body = await readJson(request);
    const project = service.createProject({
      name: requireString(body, "name"),
      path: requireString(body, "path")
    });
    sendJson(response, 201, project);
    return true;
  }

  if (method === "GET" && parts.join("/") === "api/tasks") {
    sendJson(response, 200, service.listTasks());
    return true;
  }

  if (method === "POST" && parts.join("/") === "api/tasks") {
    const body = await readJson(request);
    const result = await service.createTask({
      projectId: requireString(body, "projectId"),
      prompt: requireString(body, "prompt"),
      title: optionalString(body, "title"),
      recipeId: optionalString(body, "recipeId"),
      model: optionalString(body, "model")
    });
    sendJson(response, 201, result);
    return true;
  }

  if (method === "GET" && parts.join("/") === "api/threads") {
    sendJson(response, 200, service.listThreads());
    return true;
  }

  if (parts[0] === "api" && parts[1] === "threads" && parts[2]) {
    const threadId = parts[2];
    if (method === "GET" && parts.length === 3) {
      sendJson(response, 200, service.getThreadDetail(threadId));
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

    if (method === "POST" && parts[3] === "steer") {
      const body = await readJson(request);
      await service.steerTurn(threadId, requireString(body, "prompt"));
      sendNoContent(response);
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
        const goal = await service.setGoal(threadId, requireString(body, "objective"));
        sendJson(response, 200, goal);
        return true;
      }
      if (method === "DELETE") {
        sendJson(response, 200, await service.clearGoal(threadId));
        return true;
      }
    }
  }

  if (method === "GET" && parts.join("/") === "api/approvals") {
    sendJson(response, 200, service.listApprovals());
    return true;
  }

  if (method === "POST" && parts[0] === "api" && parts[1] === "approvals" && parts[2] && parts[3] === "resolve") {
    const body = await readJson(request);
    const approved = body.approved === true;
    const reviewer = optionalString(body, "reviewer") ?? "local";
    const approval = await service.resolveApproval(parts[2], approved, reviewer);
    sendJson(response, 200, approval);
    return true;
  }

  return false;
}

function applyCorsHeaders(response: ServerResponse, requestOrigin: string | undefined, corsOrigin: string | null) {
  if (!corsOrigin || requestOrigin !== corsOrigin) {
    return;
  }
  response.setHeader("access-control-allow-origin", corsOrigin);
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

export function createHttpServer(
  service: ControlService,
  options: { clientDistDir?: string | null; corsOrigin?: string | null } = {}
) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    applyCorsHeaders(response, request.headers.origin, options.corsOrigin ?? null);
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
}
