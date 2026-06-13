import { describe, expect, it } from "vitest"
import { parseServerArgs } from "../src/server/index.js"

describe("server argument parsing", () => {
  it("uses zero verbosity by default", () => {
    expect(parseServerArgs([])).toEqual({ verbosity: 0 })
  })

  it("reads short verbosity flags", () => {
    expect(parseServerArgs(["-v"])).toEqual({ verbosity: 1 })
    expect(parseServerArgs(["-vv"])).toEqual({ verbosity: 2 })
    expect(parseServerArgs(["-vvv"])).toEqual({ verbosity: 3 })
  })

  it("accumulates and caps verbosity", () => {
    expect(parseServerArgs(["-v", "-v", "-v"])).toEqual({ verbosity: 3 })
    expect(parseServerArgs(["-v", "-vv"])).toEqual({ verbosity: 3 })
    expect(parseServerArgs(["-vvvv"])).toEqual({ verbosity: 3 })
  })

  it("does not treat the old debug flag as verbosity", () => {
    expect(parseServerArgs(["--debug"])).toEqual({ verbosity: 0 })
  })
})
