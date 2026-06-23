import { join } from "node:path";
import { readDebugLevel } from "../config.js";
import { AppServerCodexAdapter } from "./codex/appServerAdapter.js";
import { ControlService } from "./service.js";
import { Store } from "./store.js";

const dataDir = ".coz";

export function createServiceFromEnv() {
	const cwd = /* turbopackIgnore: true */ process.cwd();
	const codexBin = process.env.COZ_CODEX_BIN ?? "codex";
	const store = Store.open(join(dataDir, "coz.sqlite"));
	const debugLevel = readDebugLevel(process.env);
	const adapter = new AppServerCodexAdapter(codexBin, {
		dataDir,
		debugLogPath: debugLevel > 0 ? join(dataDir, "debug.jsonl") : null,
		debugLogLevel: debugLevel,
	});
	const service = new ControlService(store, adapter);
	service.seedLocalState({
		cwd,
		adapterName: adapter.name,
		cliVersion: null,
	});
	return service;
}
