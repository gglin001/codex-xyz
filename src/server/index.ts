import { connectableOrigin, readApiUrl, readUiUrl } from "../config.js";
import { createHttpServer } from "./http.js";
import { createServiceFromEnv, parseServerArgs } from "./serviceFactory.js";

export { createServiceFromEnv, parseServerArgs };

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseServerArgs(process.argv.slice(2));
  const service = createServiceFromEnv(options);
  const apiUrl = readApiUrl(process.env);
  const uiUrl = readUiUrl(process.env);
  const corsOrigins = [...new Set([uiUrl.origin, connectableOrigin(uiUrl)])];
  const server = createHttpServer(service, { corsOrigins });
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
