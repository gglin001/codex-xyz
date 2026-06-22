#!/usr/bin/env node
import { spawn } from "node:child_process";

const uiUrl = process.env.COZ_UI_URL || "http://127.0.0.1:1123";

try {
	const url = new URL(uiUrl);
	const hostname = url.hostname;
	const port = url.port || "1123";

	console.log(
		`Starting Next.js on ${hostname}:${port} (parsed from COZ_UI_URL)`,
	);

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
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
