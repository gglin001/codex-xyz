import { spawn } from 'node:child_process';

const uiUrl = process.env.CODEX_XYZ_UI_URL || "http://127.0.0.1:1123";

try {
  const url = new URL(uiUrl);
  const hostname = url.hostname;
  const port = url.port || "1123";

  console.log(`Starting Next.js on ${hostname}:${port} (parsed from CODEX_XYZ_UI_URL)`);

  const child = spawn('npx', ['next', 'dev', '--hostname', hostname, '--port', port], {
    stdio: 'inherit',
    shell: true
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

} catch (error) {
  console.error(error.message);
  process.exit(1);
}
