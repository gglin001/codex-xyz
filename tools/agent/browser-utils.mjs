import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const defaultUiUrl = process.env.CODEX_XYZ_UI_URL || "http://127.0.0.1:1123";
export const debugDir = process.env.AGENT_DEBUG_DIR || "debug_agent";

export function parseViewport(value = "1280,900") {
  const match = String(value).match(/^(\d+)\s*[,x]\s*(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid viewport: ${value}`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function debugPath(file = "screenshot.png") {
  if (path.isAbsolute(file)) {
    return file;
  }
  if (file === debugDir || file.startsWith(`${debugDir}${path.sep}`)) {
    return path.resolve(file);
  }
  return path.resolve(debugDir, file);
}

function chromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return "google-chrome";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

export async function playwrightScreenshot({
  url = defaultUiUrl,
  output = "screenshot.png",
  viewport = "1280,900",
  selector,
  wait = 1000,
  fullPage = false
} = {}) {
  const size = parseViewport(viewport);
  const file = debugPath(output);
  await mkdir(path.dirname(file), { recursive: true });

  const args = [
    "screenshot",
    "--channel",
    "chrome",
    "--viewport-size",
    `${size.width},${size.height}`
  ];
  if (selector) {
    args.push("--wait-for-selector", selector);
  }
  if (wait !== null) {
    args.push("--wait-for-timeout", String(wait));
  }
  if (fullPage) {
    args.push("--full-page");
  }
  args.push(url, file);

  await run(process.env.PLAYWRIGHT_BIN || "playwright", args);
  return { url, output: file, viewport: size };
}

async function availablePort(start = 9334) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available CDP port near ${start}`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function waitForJson(url, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("WebSocket error")));
      this.ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws?.close();
  }
}

export class Browser {
  constructor({ cdp, process, stderrFile, getStderr }) {
    this.cdp = cdp;
    this.process = process;
    this.stderrFile = stderrFile;
    this.getStderr = getStderr;
  }

  async evaluate(expression) {
    const result = await this.cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result?.value;
  }

  async waitForExpression(expression, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression);
      if (value) {
        return value;
      }
      await delay(100);
    }
    throw new Error(`Timed out waiting for expression: ${expression}`);
  }

  waitForSelector(selector, timeout) {
    return this.waitForExpression(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeout);
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`);
    if (!ok) {
      throw new Error(`Could not click ${selector}`);
    }
  }

  async type(selector, text) {
    const ok = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.focus();
      return true;
    })()`);
    if (!ok) {
      throw new Error(`Could not focus ${selector}`);
    }
    await this.cdp.send("Input.insertText", { text });
  }

  async screenshot(output = "screenshot.png", { fullPage = false } = {}) {
    const file = debugPath(output);
    await mkdir(path.dirname(file), { recursive: true });
    const result = await this.cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage
    });
    await writeFile(file, Buffer.from(result.data, "base64"));
    return file;
  }

  async close() {
    this.cdp.close();
    this.process.kill("SIGTERM");

    const stderr = this.getStderr();
    if (stderr) {
      await mkdir(path.dirname(this.stderrFile), { recursive: true });
      await writeFile(this.stderrFile, stderr);
    }
  }
}

export async function launchBrowser({
  url = defaultUiUrl,
  name = "agent",
  viewport = "1280,900",
  timeout = 8000,
  mobile = false,
  headed = false
} = {}) {
  const size = parseViewport(viewport);
  const port = await availablePort();
  const profile = debugPath(`chrome-${name}-profile`);
  const stderrFile = debugPath(`chrome-${name}.stderr.log`);

  await rm(profile, { force: true, recursive: true });
  await mkdir(profile, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    `--window-size=${size.width},${size.height}`,
    "about:blank"
  ];
  if (!headed) {
    args.unshift("--headless=new");
  }

  const chrome = spawn(chromePath(), args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, timeout);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, timeout);
    const target = targets.find((entry) => entry.type === "page");
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("No page target available");
    }

    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    if (mobile) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 2,
        mobile: true
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    }

    const browser = new Browser({
      cdp,
      process: chrome,
      stderrFile,
      getStderr: () => stderr
    });
    await cdp.send("Page.navigate", { url });
    await browser.waitForExpression("document.readyState === 'complete'", timeout);
    return browser;
  } catch (error) {
    chrome.kill("SIGTERM");
    throw error;
  }
}
