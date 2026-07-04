type Env = Record<string, string | undefined>;

export type LocalWebSearchConfig = {
	provider: "searxng";
	endpoint: string;
	maxResults: number;
	timeoutMs: number;
};

function optionalEnv(env: Env, key: string) {
	const value = env[key]?.trim();
	return value && value.length > 0 ? value : null;
}

function integerEnv(
	env: Env,
	key: string,
	fallback: number,
	minimum: number,
	maximum: number,
) {
	const raw = optionalEnv(env, key);
	if (!raw) {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new Error(
			`${key} must be an integer between ${minimum} and ${maximum}.`,
		);
	}
	return value;
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

export function readLocalWebSearchConfig(
	env: Env = process.env,
): LocalWebSearchConfig | null {
	const provider =
		optionalEnv(env, "COZ_WEB_SEARCH_PROVIDER") ??
		optionalEnv(env, "COZ_WEB_SEARCH");
	if (
		!provider ||
		provider === "0" ||
		provider === "false" ||
		provider === "off" ||
		provider === "disabled"
	) {
		return null;
	}
	if (provider !== "searxng") {
		throw new Error("COZ_WEB_SEARCH_PROVIDER must be searxng or disabled.");
	}
	const endpoint =
		optionalEnv(env, "COZ_SEARXNG_URL") ?? optionalEnv(env, "SEARXNG_URL");
	if (!endpoint) {
		throw new Error(
			"COZ_SEARXNG_URL is required when COZ_WEB_SEARCH_PROVIDER=searxng.",
		);
	}
	const url = new URL(endpoint);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("COZ_SEARXNG_URL must be an http or https URL.");
	}
	return {
		provider: "searxng",
		endpoint,
		maxResults: integerEnv(env, "COZ_WEB_SEARCH_MAX_RESULTS", 10, 1, 20),
		timeoutMs: integerEnv(
			env,
			"COZ_WEB_SEARCH_TIMEOUT_MS",
			10_000,
			1_000,
			60_000,
		),
	};
}
