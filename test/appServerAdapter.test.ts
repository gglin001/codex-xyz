import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AppServerCodexAdapter } from "../src/server/codex/appServerAdapter.js"

let tempDir: string | null = null
let adapter: AppServerCodexAdapter | null = null

function createFakeCodexCommand() {
  tempDir = mkdtempSync(join(tmpdir(), "codex-xyz-app-server-"))
  const commandPath = join(tempDir, "fake-codex.cjs")
  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
let buffer = ""
let experimentalApi = false

function respond(id, result) {
  process.stdout.write(JSON.stringify({ id, result }) + "\\n")
}

function reject(id, message) {
  process.stdout.write(JSON.stringify({ id, error: { message } }) + "\\n")
}

function handle(message) {
  if (message.method === "initialize") {
    experimentalApi = message.params?.capabilities?.experimentalApi === true
    respond(message.id, {
      userAgent: "fake-codex",
      codexHome: process.cwd(),
      platformFamily: "unix",
      platformOs: "macos"
    })
    return
  }

  if (message.method === "initialized") {
    return
  }

  if (message.method === "thread/resume") {
    if (message.params?.excludeTurns === true && !experimentalApi) {
      reject(message.id, "thread/resume.excludeTurns requires experimentalApi capability")
      return
    }
    respond(message.id, {
      thread: {
        id: message.params.threadId,
        sessionId: message.params.threadId,
        forkedFromId: null,
        preview: "resumed without turns",
        cwd: message.params.cwd,
        model: message.params.model
      },
      model: message.params.model
    })
  }
}

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf("\\n")
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      handle(JSON.parse(line))
    }
    newline = buffer.indexOf("\\n")
  }
})
`
  )
  chmodSync(commandPath, 0o755)
  return commandPath
}

afterEach(async () => {
  await adapter?.close()
  adapter = null
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe("AppServerCodexAdapter", () => {
  it("opts into experimental fields before resuming without turns", async () => {
    const command = createFakeCodexCommand()
    adapter = new AppServerCodexAdapter(command)

    const thread = await adapter.resumeThread({
      threadId: "thread_1",
      cwd: process.cwd(),
      model: "test-model"
    })

    expect(thread).toMatchObject({
      id: "thread_1",
      preview: "resumed without turns",
      model: "test-model"
    })
  })
})
