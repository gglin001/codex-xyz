type Env = Record<string, string | undefined>;

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
		throw new Error(
			"COZ_DEBUG_LEVEL must be an integer between 0 and 3.",
		);
	}
	return level;
}
