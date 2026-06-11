import { spawn } from "node:child_process";

const processes = [
  spawn("npm", ["run", "dev:api"], {
    stdio: "inherit",
    env: { ...process.env, CODEX_XYZ_ADAPTER: process.env.CODEX_XYZ_ADAPTER ?? "mock" }
  }),
  spawn("npm", ["run", "dev:web"], {
    stdio: "inherit",
    env: process.env
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
