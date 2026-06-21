import { describe, expect, it } from "vitest"
import { resolveSwipeDirection } from "../src/client/useSwipeGesture.js"

describe("resolveSwipeDirection", () => {
  it("keeps the default vertical threshold at 60px", () => {
    expect(resolveSwipeDirection({ dx: 0, dy: -61 })).toBe("up")
    expect(resolveSwipeDirection({ dx: 0, dy: -59 })).toBeNull()
  })

  it("supports a stricter threshold for upward swipes", () => {
    expect(resolveSwipeDirection({
      dx: 0,
      dy: -80,
      directionThresholds: { up: 88 }
    })).toBeNull()

    expect(resolveSwipeDirection({
      dx: 0,
      dy: -88,
      directionThresholds: { up: 88 }
    })).toBe("up")
  })

  it("filters diagonal movement when an axis lock ratio is configured", () => {
    expect(resolveSwipeDirection({
      dx: 80,
      dy: -90,
      axisLockRatio: 1.15,
      directionThresholds: { up: 88 }
    })).toBeNull()

    expect(resolveSwipeDirection({
      dx: 20,
      dy: -88,
      axisLockRatio: 1.15,
      directionThresholds: { up: 88 }
    })).toBe("up")
  })

  it("does not apply upward sensitivity changes to horizontal swipes", () => {
    expect(resolveSwipeDirection({
      dx: 61,
      dy: 0,
      directionThresholds: { up: 88 },
      nearLeftEdge: true
    })).toBe("right")
  })
})
