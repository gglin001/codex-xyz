import { spawn } from "node:child_process";

const webEnv = {
  ...process.env,
  VITE_CODEX_XYZ_API_URL: process.env.VITE_CODEX_XYZ_API_URL ?? process.env.CODEX_XYZ_API_URL ?? ""
};

const processes = [
  spawn("pnpm", ["run", "dev:api"], {
    stdio: "inherit",
    env: { ...process.env, CODEX_XYZ_ADAPTER: process.env.CODEX_XYZ_ADAPTER ?? "mock" }
  }),
  spawn("pnpm", ["run", "dev:web"], {
    stdio: "inherit",
    env: webEnv
  })
];

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

for (const child of processes) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      stopAll(signal ?? "SIGTERM");
      process.exitCode = code ?? 1;
    }
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
