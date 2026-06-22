import type { ControlService } from "./service.js";
import { createServiceFromEnv } from "./serviceFactory.js";

const serviceKey = Symbol.for("coz.service");

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
