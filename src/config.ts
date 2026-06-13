export const DEFAULT_CODEX_XYZ_API_URL = "http://127.0.0.1:3211";
export const DEFAULT_CODEX_XYZ_UI_URL = "http://127.0.0.1:1123";

type Env = Record<string, string | undefined>;

export type AppUrl = {
  origin: string;
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
};

function optionalEnv(env: Env, key: string) {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function parsePort(value: string, key: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be a TCP port between 1 and 65535.`);
  }
  return port;
}

export function parseAppUrl(value: string, key: string): AppUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${key} must use http or https.`);
  }

  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const port = url.port ? parsePort(url.port, key) : defaultPort;
  return {
    origin: url.origin,
    hostname: url.hostname,
    port,
    protocol: url.protocol
  };
}

export function connectableOrigin(appUrl: AppUrl) {
  const url = new URL(appUrl.origin);
  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  } else if (url.hostname === "[::]") {
    url.hostname = "[::1]";
  }
  return url.origin;
}

export function readApiUrl(env: Env = process.env) {
  const configuredUrl = optionalEnv(env, "CODEX_XYZ_API_URL");
  if (configuredUrl) {
    return parseAppUrl(configuredUrl, "CODEX_XYZ_API_URL");
  }

  const configuredPort = optionalEnv(env, "PORT");
  if (configuredPort) {
    parsePort(configuredPort, "PORT");
    return parseAppUrl(`http://127.0.0.1:${configuredPort}`, "PORT");
  }

  return parseAppUrl(DEFAULT_CODEX_XYZ_API_URL, "CODEX_XYZ_API_URL");
}

export function readUiUrl(env: Env = process.env) {
  return parseAppUrl(optionalEnv(env, "CODEX_XYZ_UI_URL") ?? DEFAULT_CODEX_XYZ_UI_URL, "CODEX_XYZ_UI_URL");
}
