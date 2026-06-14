#!/usr/bin/env node
import { launchBrowser, playwrightScreenshot } from "./browser-utils.mjs";

function help() {
  console.log(`Usage:
  node tools/agent/browser.mjs screenshot [options]
  node tools/agent/browser.mjs run [options] [actions]

Screenshot:
  --url URL
  --output FILE
  --viewport WIDTH,HEIGHT
  --wait-selector SELECTOR
  --wait-timeout MS
  --full-page

Run options:
  --url URL
  --name NAME
  --viewport WIDTH,HEIGHT
  --timeout MS
  --mobile
  --headed
  --json

Run actions:
  --wait-selector SELECTOR
  --wait-expr EXPR
  --click SELECTOR
  --type SELECTOR TEXT
  --eval EXPR
  --delay MS
  --screenshot FILE
`);
}

function take(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseScreenshot(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--url") {
      options.url = take(args, index, flag);
      index += 1;
    } else if (flag === "--output") {
      options.output = take(args, index, flag);
      index += 1;
    } else if (flag === "--viewport") {
      options.viewport = take(args, index, flag);
      index += 1;
    } else if (flag === "--wait-selector") {
      options.selector = take(args, index, flag);
      index += 1;
    } else if (flag === "--wait-timeout") {
      options.wait = Number(take(args, index, flag));
      index += 1;
    } else if (flag === "--full-page") {
      options.fullPage = true;
    } else {
      throw new Error(`Unknown screenshot option: ${flag}`);
    }
  }

  return options;
}

function parseRun(args) {
  const options = {};
  const actions = [];

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--url") {
      options.url = take(args, index, flag);
      index += 1;
    } else if (flag === "--name") {
      options.name = take(args, index, flag);
      index += 1;
    } else if (flag === "--viewport") {
      options.viewport = take(args, index, flag);
      index += 1;
    } else if (flag === "--timeout") {
      options.timeout = Number(take(args, index, flag));
      index += 1;
    } else if (flag === "--mobile") {
      options.mobile = true;
    } else if (flag === "--headed") {
      options.headed = true;
    } else if (flag === "--json") {
      options.json = true;
    } else if (flag === "--wait-selector") {
      actions.push(["waitSelector", take(args, index, flag)]);
      index += 1;
    } else if (flag === "--wait-expr") {
      actions.push(["waitExpr", take(args, index, flag)]);
      index += 1;
    } else if (flag === "--click") {
      actions.push(["click", take(args, index, flag)]);
      index += 1;
    } else if (flag === "--type") {
      const selector = take(args, index, flag);
      const text = args[index + 2];
      if (text === undefined || text.startsWith("--")) {
        throw new Error("--type requires SELECTOR and TEXT");
      }
      actions.push(["type", selector, text]);
      index += 2;
    } else if (flag === "--eval") {
      actions.push(["eval", take(args, index, flag)]);
      index += 1;
    } else if (flag === "--delay") {
      actions.push(["delay", Number(take(args, index, flag))]);
      index += 1;
    } else if (flag === "--screenshot") {
      actions.push(["screenshot", take(args, index, flag)]);
      index += 1;
    } else {
      throw new Error(`Unknown run option or action: ${flag}`);
    }
  }

  return { options, actions };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runActions(options, actions) {
  const browser = await launchBrowser(options);
  const results = [];

  try {
    for (const [kind, value, extra] of actions) {
      if (kind === "waitSelector") {
        await browser.waitForSelector(value, options.timeout);
        results.push({ kind, selector: value });
      } else if (kind === "waitExpr") {
        results.push({ kind, value: await browser.waitForExpression(value, options.timeout) });
      } else if (kind === "click") {
        await browser.click(value);
        results.push({ kind, selector: value });
      } else if (kind === "type") {
        await browser.type(value, extra);
        results.push({ kind, selector: value });
      } else if (kind === "eval") {
        results.push({ kind, value: await browser.evaluate(value) });
      } else if (kind === "delay") {
        await delay(value);
        results.push({ kind, ms: value });
      } else if (kind === "screenshot") {
        results.push({ kind, output: await browser.screenshot(value) });
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help" || command === "help") {
    help();
    return;
  }

  if (command === "screenshot") {
    console.log(JSON.stringify(await playwrightScreenshot(parseScreenshot(args)), null, 2));
    return;
  }

  if (command === "run") {
    const { options, actions } = parseRun(args);
    const results = await runActions(options, actions);
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const result of results) {
        console.log(JSON.stringify(result));
      }
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  if (error?.stderr) {
    console.error(error.stderr.trim());
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
