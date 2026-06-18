import { execFileSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { AppServerCodexAdapter } from "./codex/appServerAdapter.js";
import { ControlService } from "./service.js";
import { Store } from "./store.js";

export type ServerOptions = {
  verbosity?: number;
};

const maxVerbosity = 3;

function codexVersion() {
  try {
    const bin = process.env.CODEX_XYZ_CODEX_BIN ?? "codex";
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function parseServerArgs(argv: string[]): ServerOptions {
  const verbosity = argv.reduce((total, arg) => {
    if (!/^-v+$/.test(arg)) {
      return total;
    }
    return total + arg.length - 1;
  }, 0);

  return {
    verbosity: Math.min(maxVerbosity, verbosity)
  };
}

export function createServiceFromEnv(options: ServerOptions = {}) {
  const cwd = process.cwd();
  const configuredDataDir = process.env.CODEX_XYZ_DATA_DIR;
  const dataDir = configuredDataDir
    ? isAbsolute(configuredDataDir)
      ? configuredDataDir
      : resolve(/* turbopackIgnore: true */ cwd, configuredDataDir)
    : resolve(cwd, ".codex-xyz");
  const codexBin = process.env.CODEX_XYZ_CODEX_BIN ?? "codex";
  const store = Store.open(resolve(dataDir, "codex-xyz.sqlite"));
  const verbosity = Math.min(maxVerbosity, Math.max(0, Math.floor(options.verbosity ?? 0)));
  const adapter = new AppServerCodexAdapter(codexBin, {
    debugLogPath: verbosity > 0 ? resolve(dataDir, "debug.jsonl") : null,
    debugLogLevel: verbosity
  });
  const service = new ControlService(store, adapter);
  service.seedLocalState({
    cwd,
    adapterName: adapter.name,
    cliVersion: codexVersion()
  });
  return service;
}
