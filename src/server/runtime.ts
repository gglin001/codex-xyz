import { createServiceFromEnv } from "./serviceFactory.js";
import type { ControlService } from "./service.js";

const serviceKey = Symbol.for("codex-xyz.service");

type GlobalWithService = typeof globalThis & {
  [serviceKey]?: ControlService;
};

export function getService() {
  const globalWithService = globalThis as GlobalWithService;
  if (!globalWithService[serviceKey]) {
    globalWithService[serviceKey] = createServiceFromEnv();
  }
  return globalWithService[serviceKey];
}

export async function closeService() {
  const globalWithService = globalThis as GlobalWithService;
  const service = globalWithService[serviceKey];
  if (!service) {
    return;
  }
  delete globalWithService[serviceKey];
  await service.close();
}
