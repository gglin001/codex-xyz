import type { RefObject } from "react"
import { useEffect, useRef } from "react"

export type SwipeHandlers = {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
}

export type SwipeGestureOptions = {
  enabled?: boolean
  threshold?: number
  edgeSize?: number
  ignoreInteractive?: boolean
}

type SwipeStart = {
  x: number
  y: number
  nearLeftEdge: boolean
  nearRightEdge: boolean
}

const interactiveTargetSelector = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[data-swipe-ignore='true']"
].join(",")

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(interactiveTargetSelector) !== null
}

/**
 * Listens for touch-swipe gestures on `elementRef` and fires the
 * corresponding handler when the dominant movement exceeds `threshold`.
 */
export function useSwipeGesture(
  elementRef: RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
  options: SwipeGestureOptions = {}
) {
  const {
    enabled = true,
    threshold = 60,
    edgeSize,
    ignoreInteractive = false
  } = options
  const startRef = useRef<SwipeStart | null>(null)

  useEffect(() => {
    if (
      !enabled ||
      (!handlers.onSwipeLeft && !handlers.onSwipeRight && !handlers.onSwipeUp && !handlers.onSwipeDown)
    ) {
      return
    }
    const el = elementRef.current
    if (!el) return

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (ignoreInteractive && isInteractiveTarget(event.target))) {
        startRef.current = null
        return
      }
      const touch = event.touches[0]
      const viewportWidth = window.innerWidth
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        nearLeftEdge: edgeSize === undefined || touch.clientX <= edgeSize,
        nearRightEdge: edgeSize === undefined || touch.clientX >= viewportWidth - edgeSize
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      const start = startRef.current
      startRef.current = null
      if (!start || event.changedTouches.length !== 1) return
      const dx = event.changedTouches[0].clientX - start.x
      const dy = event.changedTouches[0].clientY - start.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (absDx >= absDy) {
        if (absDx < threshold) return
        if (dx <= 0) {
          if (!start.nearRightEdge) return
          handlers.onSwipeLeft?.()
          return
        }
        if (!start.nearLeftEdge) return
        handlers.onSwipeRight?.()
        return
      }

      if (absDy < threshold) return
      if (dy <= 0) {
        handlers.onSwipeUp?.()
        return
      }
      handlers.onSwipeDown?.()
    }

    const onTouchCancel = () => {
      startRef.current = null
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchend", onTouchEnd, { passive: true })
    el.addEventListener("touchcancel", onTouchCancel, { passive: true })

    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchCancel)
    }
  }, [
    edgeSize,
    elementRef,
    enabled,
    handlers.onSwipeLeft,
    handlers.onSwipeRight,
    handlers.onSwipeUp,
    handlers.onSwipeDown,
    ignoreInteractive,
    threshold
  ])
}
