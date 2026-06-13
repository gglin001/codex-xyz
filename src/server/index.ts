import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { AppServerCodexAdapter } from "./codex/appServerAdapter.js";
import { connectableOrigin, readApiUrl, readUiUrl } from "../config.js";
import { createHttpServer } from "./http.js";
import { ControlService } from "./service.js";
import { Store } from "./store.js";

export type ServerOptions = {
  debug?: boolean;
};

function codexVersion() {
  try {
    const bin = process.env.CODEX_XYZ_CODEX_BIN ?? "codex";
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function parseServerArgs(argv: string[]): ServerOptions {
  return {
    debug: argv.includes("--debug")
  };
}

export function createServiceFromEnv(options: ServerOptions = {}) {
  const dataDir = resolve(process.cwd(), process.env.CODEX_XYZ_DATA_DIR ?? ".codex-xyz");
  const codexBin = process.env.CODEX_XYZ_CODEX_BIN ?? "codex";
  const store = Store.open(resolve(dataDir, "codex-xyz.sqlite"));
  const adapter = new AppServerCodexAdapter(codexBin, {
    debugLogPath: options.debug ? resolve(dataDir, "debug.jsonl") : null
  });
  const service = new ControlService(store, adapter);
  service.seedLocalState({
    cwd: process.cwd(),
    adapterName: adapter.name,
    cliVersion: codexVersion()
  });
  return service;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseServerArgs(process.argv.slice(2));
  const service = createServiceFromEnv(options);
  const apiUrl = readApiUrl(process.env);
  const uiUrl = readUiUrl(process.env);
  const corsOrigins = [...new Set([uiUrl.origin, connectableOrigin(uiUrl)])];
  const clientDistDir = resolve(process.cwd(), "dist/client");
  const server = createHttpServer(service, { clientDistDir, corsOrigins });
  server.listen(apiUrl.port, apiUrl.hostname, () => {
    console.log(`codex-xyz API listening on ${apiUrl.origin}`);
  });

  async function shutdown() {
    server.close();
    await service.close();
  }

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}
