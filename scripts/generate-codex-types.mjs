import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(repoRoot, "src/generated/codex-app-server");

async function main() {
  if (process.env.CODEX_XYZ_SKIP_CODEX_GENERATE === "1") {
    await mkdir(outDir, { recursive: true });
    await writeFile(
      resolve(outDir, "manifest.json"),
      JSON.stringify(
        {
          skipped: true,
          reason: "CODEX_XYZ_SKIP_CODEX_GENERATE=1",
          generatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
    return;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const codex = process.env.CODEX_XYZ_CODEX_BIN ?? "codex";
  const { stdout: version } = await execFileAsync(codex, ["--version"], {
    cwd: repoRoot
  });

  await execFileAsync(
    codex,
    ["app-server", "generate-ts", "--experimental", "--out", outDir],
    {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024
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
