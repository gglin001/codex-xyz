import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AppServerCodexAdapter } from "../src/server/codex/appServerAdapter.js"

let tempDir: string | null = null
let adapter: AppServerCodexAdapter | null = null
const sourceThreadId = "00000000-0000-4000-8000-000000000001"
const debugThreadId = "00000000-0000-4000-8000-000000000002"
const forkThreadId = "00000000-0000-4000-8000-000000000003"

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
    if (!/^[0-9a-f-]{36}$/i.test(message.params?.threadId ?? "")) {
      reject(message.id, "invalid session id")
      return
    }
    respond(message.id, {
      thread: {
        id: "thread_" + message.params.threadId,
        sessionId: message.params.threadId,
        forkedFromId: null,
        preview: "resumed without turns",
        cwd: message.params.cwd,
        model: message.params.model
      },
      model: message.params.model
    })
    return
  }

  if (message.method === "thread/fork") {
    if (!/^[0-9a-f-]{36}$/i.test(message.params?.threadId ?? "")) {
      reject(message.id, "invalid session id")
      return
    }
    respond(message.id, {
      thread: {
        id: "thread_00000000-0000-4000-8000-000000000003",
        sessionId: message.params.threadId,
        forkedFromId: "thread_" + message.params.threadId,
        preview: "forked without turns",
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
      threadId: sourceThreadId,
      cwd: process.cwd(),
      model: "test-model"
    })

    expect(thread).toMatchObject({
      id: sourceThreadId,
      preview: "resumed without turns",
      model: "test-model"
    })
  })

  it("normalizes app-server thread ids before callers reuse them", async () => {
    const command = createFakeCodexCommand()
    adapter = new AppServerCodexAdapter(command)

    const source = await adapter.resumeThread({
      threadId: sourceThreadId,
      cwd: process.cwd(),
      model: "test-model"
    })
    const fork = await adapter.forkThread({
      sourceThreadId: source.id,
      cwd: process.cwd(),
      model: "test-model"
    })

    expect(fork).toMatchObject({
      id: forkThreadId,
      forkedFromId: sourceThreadId,
      preview: "forked without turns"
    })
  })

  it("writes app-server protocol debug records as JSON lines", async () => {
    const command = createFakeCodexCommand()
    const debugLogPath = join(tempDir as string, ".codex-xyz", "debug.jsonl")
    adapter = new AppServerCodexAdapter(command, { debugLogPath })

    await adapter.resumeThread({
      threadId: debugThreadId,
      cwd: process.cwd(),
      model: "test-model"
    })

    const records = readFileSync(debugLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "app-server",
          event: "process.spawn"
        }),
        expect.objectContaining({
          direction: "out",
          message: expect.objectContaining({ method: "initialize" })
        }),
        expect.objectContaining({
          direction: "out",
          message: expect.objectContaining({ method: "thread/resume" })
        }),
        expect.objectContaining({
          direction: "in",
          message: expect.objectContaining({
            result: expect.objectContaining({
              thread: expect.objectContaining({ id: `thread_${debugThreadId}` })
            })
          })
        })
      ])
    )
  })
})
