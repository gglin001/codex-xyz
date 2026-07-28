#!/usr/bin/env node
import { spawn } from "node:child_process";

const hostname = process.env.COZ_UI_IP || "127.0.0.1";
const port = process.env.COZ_UI_PORT || "11235";

console.log(`Starting Next.js dev on ${hostname}:${port}`);

const child = spawn(
	"pnpm",
	["exec", "next", "dev", "--hostname", hostname, "--port", port],
	{
		stdio: "inherit",
	},
);

child.on("exit", (code) => {
	process.exit(code ?? 0);
});
