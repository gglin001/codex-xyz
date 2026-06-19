import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(repoRoot, "src/generated/codex-app-server");

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { stdout: version } = await execFileAsync("codex", ["--version"], {
    cwd: repoRoot
  });

  await execFileAsync(
    "codex",
    ["app-server", "generate-ts", "--experimental", "--out", outDir],
    {
      cwd: repoRoot
    }
  );

  await writeFile(
    resolve(outDir, "manifest.json"),
    JSON.stringify(
      {
        codexVersion: version.trim(),
        generatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
