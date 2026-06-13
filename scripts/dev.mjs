import { spawn } from "node:child_process";

const apiArgs = ["run", "dev:api"];
if (process.argv.length > 2) {
  apiArgs.push("--", ...process.argv.slice(2));
}

const processes = [
  spawn("pnpm", apiArgs, {
    stdio: "inherit"
  }),
  spawn("pnpm", ["run", "dev:web"], {
    stdio: "inherit"
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
