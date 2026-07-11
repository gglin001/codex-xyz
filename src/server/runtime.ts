import type { ControlService } from "./service.js";
import { createServiceFromEnv } from "./serviceFactory.js";

const serviceKey = Symbol.for("coz.service");
const serviceSchemaVersion = 5;

type ServiceEntry = {
	schemaVersion: number;
	service: ControlService;
};

type GlobalWithService = typeof globalThis & {
	[serviceKey]?: ControlService | ServiceEntry;
};

function serviceFromEntry(entry: ControlService | ServiceEntry | undefined) {
	if (!entry) {
		return null;
	}
	return "service" in entry ? entry.service : entry;
}

function serviceEntryIsCurrent(
	entry: ControlService | ServiceEntry | undefined,
) {
	return Boolean(
		entry && "service" in entry && entry.schemaVersion === serviceSchemaVersion,
	);
}

export function getService() {
	const globalWithService = globalThis as GlobalWithService;
	const current = globalWithService[serviceKey];
	if (!serviceEntryIsCurrent(current)) {
		const oldService = serviceFromEntry(current);
		if (oldService) {
			void oldService.close().catch(() => {});
		}
		globalWithService[serviceKey] = {
			schemaVersion: serviceSchemaVersion,
			service: createServiceFromEnv(),
		};
	}
	const entry = globalWithService[serviceKey];
	return serviceFromEntry(entry) as ControlService;
}

export async function closeService() {
	const globalWithService = globalThis as GlobalWithService;
	const service = serviceFromEntry(globalWithService[serviceKey]);
	if (!service) {
		return;
	}
	delete globalWithService[serviceKey];
	await service.close();
}
