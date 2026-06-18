import { createServer } from "node:http";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import { connectableOrigin, readUiUrl } from "../config.js";
import { handleTerminalWebSocketConnection } from "./http.js";
import { createServiceFromEnv, parseServerArgs } from "./serviceFactory.js";

const options = parseServerArgs(process.argv.slice(2));
const service = createServiceFromEnv(options);
const uiUrl = readUiUrl(process.env);
const dev = process.env.NODE_ENV !== "production";
const require = createRequire(import.meta.url);
type NextFactory = (typeof import("next/dist/server/next.js"))["default"];
const next = require("next") as NextFactory;
const app = next({
  dev,
  hostname: uiUrl.hostname,
  port: uiUrl.port
});
const handle = app.getRequestHandler();
const handleUpgrade = app.getUpgradeHandler();
const terminalWebSocketServer = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false
});
const allowedOrigins = new Set([uiUrl.origin, connectableOrigin(uiUrl)]);

function originAllowed(origin: string | undefined) {
  return !origin || allowedOrigins.has(origin);
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy: () => void }, statusCode: number) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusCode === 403 ? "Forbidden" : "Not Found"}\r\n\r\n`);
  socket.destroy();
}

await app.prepare();

const server = createServer((request, response) => {
  void handle(request, response);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? uiUrl.origin}`);
  if (url.pathname !== "/api/terminal/ws") {
    void handleUpgrade(request, socket, head);
    return;
  }
  if (!originAllowed(request.headers.origin)) {
    rejectUpgrade(socket, 403);
    return;
  }
  terminalWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    handleTerminalWebSocketConnection(service, webSocket, url);
  });
});

server.listen(uiUrl.port, uiUrl.hostname, () => {
  console.log(`codex-xyz web listening on ${uiUrl.origin}`);
});

async function shutdown() {
  terminalWebSocketServer.close();
  server.close();
  await service.close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
