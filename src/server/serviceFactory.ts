import { join } from "node:path";
import { readDebugLevel, readWebSearchConfig } from "../config.js";
import { AppServerRuntime } from "./codex/appServerRuntime.js";
import { SearxngSearchProvider } from "./search/providers/searxng.js";
import { DefaultWebSearchService } from "./search/webSearchService.js";
import { ControlService } from "./service.js";
import { Store } from "./store.js";

const dataDir = ".coz";

export function createServiceFromEnv() {
	const cwd = /* turbopackIgnore: true */ process.cwd();
	const codexBin = process.env.COZ_CODEX_BIN ?? "codex";
	const store = Store.open(join(dataDir, "coz.sqlite"));
	const debugLevel = readDebugLevel(process.env);
	const searchConfig = readWebSearchConfig(process.env);
	const webSearchService = searchConfig
		? new DefaultWebSearchService(
				new SearxngSearchProvider(searchConfig.baseUrl),
				{ timeoutMs: searchConfig.timeoutMs },
			)
		: null;
	const runtime = new AppServerRuntime(codexBin, {
		dataDir,
		debugLogPath: debugLevel > 0 ? join(dataDir, "debug.jsonl") : null,
		debugLogLevel: debugLevel,
		webSearchService,
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
