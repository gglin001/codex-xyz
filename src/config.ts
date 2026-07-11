type Env = Record<string, string | undefined>;

export type WebSearchConfig = {
	provider: "searxng";
	baseUrl: URL;
	timeoutMs: number;
};

function optionalEnv(env: Env, key: string) {
	const value = env[key]?.trim();
	return value && value.length > 0 ? value : null;
}

export function readDebugLevel(env: Env = process.env) {
	const configuredLevel = optionalEnv(env, "COZ_DEBUG_LEVEL");
	if (!configuredLevel) {
		return 0;
	}
	const level = Number(configuredLevel);
	if (!Number.isInteger(level) || level < 0 || level > 3) {
		throw new Error("COZ_DEBUG_LEVEL must be an integer between 0 and 3.");
	}
	return level;
}

export function readWebSearchConfig(
	env: Env = process.env,
): WebSearchConfig | null {
	const provider = optionalEnv(env, "COZ_WEB_SEARCH_PROVIDER");
	if (!provider) {
		return null;
	}
	if (provider !== "searxng") {
		throw new Error("COZ_WEB_SEARCH_PROVIDER must be searxng.");
	}
	const baseUrlValue = optionalEnv(env, "COZ_SEARXNG_URL");
	if (!baseUrlValue) {
		throw new Error(
			"COZ_SEARXNG_URL is required for the searxng search provider.",
		);
	}
	let baseUrl: URL;
	try {
		baseUrl = new URL(
			baseUrlValue.endsWith("/") ? baseUrlValue : `${baseUrlValue}/`,
		);
	} catch {
		throw new Error("COZ_SEARXNG_URL must be a valid URL.");
	}
	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new Error("COZ_SEARXNG_URL must use http or https.");
	}
	const timeoutValue = optionalEnv(env, "COZ_WEB_SEARCH_TIMEOUT_MS");
	const timeoutMs = timeoutValue ? Number(timeoutValue) : 12_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
		throw new Error(
			"COZ_WEB_SEARCH_TIMEOUT_MS must be an integer between 1000 and 60000.",
		);
	}
	return { provider, baseUrl, timeoutMs };
}
