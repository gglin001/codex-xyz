import { spawn } from "node:child_process";

const defaultApiUrl = "http://127.0.0.1:3211";
const apiReadyTimeoutMs = 15_000;
const apiReadyPollMs = 150;

function optionalEnv(key) {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function apiOrigin() {
  const configuredApiUrl = optionalEnv("CODEX_XYZ_API_URL");
  if (configuredApiUrl) {
    return new URL(configuredApiUrl).origin;
  }
  const configuredPort = optionalEnv("PORT");
  if (configuredPort) {
    return new URL(`http://127.0.0.1:${configuredPort}`).origin;
  }
  return defaultApiUrl;
}

function connectableOrigin(origin) {
  const url = new URL(origin);
  if (url.hostname === "0.0.0.0") {
    url.hostname = "127.0.0.1";
  } else if (url.hostname === "[::]") {
    url.hostname = "[::1]";
  }
  return url.origin;
}

async function waitForApi(origin, child) {
  const deadline = Date.now() + apiReadyTimeoutMs;
  const healthUrl = `${origin}/api/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("API process exited before it became ready.");
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // The API process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, apiReadyPollMs));
  }
  throw new Error(`Timed out waiting for API at ${healthUrl}.`);
}

function waitForApiListenLog(child) {
  return new Promise((resolve, reject) => {
    let ready = false;
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      if (ready) {
        return;
      }
      output = `${output}${text}`.slice(-4096);
      if (output.includes("codex-xyz API listening on ")) {
        ready = true;
        resolve();
      }
    });

    child.on("exit", (code, signal) => {
      if (!ready) {
        reject(new Error(`API process exited before listening${signal ? ` (${signal})` : ` (${code ?? 0})`}.`));
      }
    });
  });
}

function waitForTimeout(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

const apiArgs = ["run", "dev:api"];
if (process.argv.length > 2) {
  apiArgs.push("--", ...process.argv.slice(2));
}

let apiProxyOrigin;
try {
  apiProxyOrigin = connectableOrigin(apiOrigin());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const processes = [];

let stopping = false;

function stopAll(signal = "SIGTERM") {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function watchChild(child) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      stopAll(signal ?? "SIGTERM");
      process.exitCode = code ?? 1;
    }
  });
}

const api = spawn("pnpm", apiArgs, {
  stdio: ["inherit", "pipe", "inherit"]
});
processes.push(api);
watchChild(api);
const apiListenLog = waitForApiListenLog(api);

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

try {
  await Promise.race([
    apiListenLog,
    waitForTimeout(apiReadyTimeoutMs, "Timed out waiting for API process to listen.")
  ]);
  await waitForApi(apiProxyOrigin, api);
  const web = spawn("pnpm", ["run", "dev:web"], {
    stdio: "inherit",
    env: process.env
  });
  processes.push(web);
  watchChild(web);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll();
  process.exitCode = 1;
}
