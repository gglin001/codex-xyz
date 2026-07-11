import { join } from "node:path";
import { readDebugLevel } from "../config.js";
import { AppServerRuntime } from "./codex/appServerRuntime.js";
import { ControlService } from "./service.js";
import { Store } from "./store.js";

const dataDir = ".coz";

export function createServiceFromEnv() {
	const cwd = /* turbopackIgnore: true */ process.cwd();
	const codexBin = process.env.COZ_CODEX_BIN ?? "codex";
	const store = Store.open(join(dataDir, "coz.sqlite"));
	const debugLevel = readDebugLevel(process.env);
	const runtime = new AppServerRuntime(codexBin, {
		dataDir,
		debugLogPath: debugLevel > 0 ? join(dataDir, "debug.jsonl") : null,
		debugLogLevel: debugLevel,
	});
	const service = new ControlService(store, runtime);
	service.seedLocalState({
		cwd,
		runtimeName: runtime.name,
		cliVersion: null,
	});
	void service.start().catch(() => {});
	return service;
}
