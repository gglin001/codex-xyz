import { describe, expect, it, vi } from "vitest"
import {
  installPageZoomGuards,
  shouldPreventPageZoomGesture,
  shouldPreventPageZoomWheel,
  type PageZoomWheelEvent
} from "../src/client/zoomGuards.js"

function wheelEvent(input: Partial<PageZoomWheelEvent>): PageZoomWheelEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    cancelable: true,
    defaultPrevented: false,
    ...input
  }
}

describe("page zoom guards", () => {
  it("guards modified wheel events that browsers use for page zoom", () => {
    expect(shouldPreventPageZoomWheel(wheelEvent({ ctrlKey: true }))).toBe(true)
    expect(shouldPreventPageZoomWheel(wheelEvent({ metaKey: true }))).toBe(true)
  })

  it("leaves ordinary and non-actionable wheel events alone", () => {
    expect(shouldPreventPageZoomWheel(wheelEvent({}))).toBe(false)
    expect(shouldPreventPageZoomWheel(wheelEvent({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(shouldPreventPageZoomWheel(wheelEvent({ ctrlKey: true, cancelable: false }))).toBe(false)
    expect(shouldPreventPageZoomWheel(wheelEvent({ ctrlKey: true, defaultPrevented: true }))).toBe(false)
  })

  it("guards cancelable WebKit gesture zoom events", () => {
    expect(shouldPreventPageZoomGesture({ cancelable: true, defaultPrevented: false })).toBe(true)
    expect(shouldPreventPageZoomGesture({ cancelable: false, defaultPrevented: false })).toBe(false)
    expect(shouldPreventPageZoomGesture({ cancelable: true, defaultPrevented: true })).toBe(false)
  })

  it("installs active capture listeners and cleans them up", () => {
    const added: Array<{ type: string; listener: EventListener; options?: AddEventListenerOptions | boolean }> = []
    const removed: Array<{ type: string; listener: EventListener; options?: EventListenerOptions | boolean }> = []
    const target = {
      addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions | boolean) {
        added.push({ type, listener, options })
      },
      removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions | boolean) {
        removed.push({ type, listener, options })
      }
    } as Window

    const cleanup = installPageZoomGuards(target)

    expect(added.map((listener) => listener.type)).toEqual(["wheel", "gesturestart", "gesturechange"])
    expect(added.every((listener) => listener.options && typeof listener.options === "object")).toBe(true)
    expect(added.map((listener) => listener.options)).toEqual([
      { capture: true, passive: false },
      { capture: true, passive: false },
      { capture: true, passive: false }
    ])

    const preventDefault = vi.fn()
    added[0]?.listener({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      cancelable: true,
      defaultPrevented: false,
      preventDefault
    } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledOnce()

    cleanup()

    expect(removed.map((listener) => listener.type)).toEqual(["wheel", "gesturestart", "gesturechange"])
    expect(removed.map((listener) => listener.listener)).toEqual(added.map((listener) => listener.listener))
    expect(removed.map((listener) => listener.options)).toEqual([{ capture: true }, { capture: true }, { capture: true }])
  })
})
