#!/usr/bin/env node
import { spawn } from "node:child_process";

const hostname = process.env.COZ_UI_IP || "127.0.0.1";
const port = process.env.COZ_UI_PORT || "1123";

console.log(`Starting Next.js on ${hostname}:${port}`);

const child = spawn(
  "pnpm",
  ["exec", "next", "start", "--hostname", hostname, "--port", port],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
