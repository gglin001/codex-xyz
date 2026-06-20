import type { RefObject } from "react"
import { useEffect, useRef } from "react"

export type SwipeHandlers = {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
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
 * corresponding handler when the horizontal distance exceeds `threshold`
 * and the swipe is more horizontal than vertical.
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
    if (!enabled || (!handlers.onSwipeLeft && !handlers.onSwipeRight)) {
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

      if (Math.abs(dx) < Math.abs(dy)) return
      if (Math.abs(dx) < threshold) return

      if (dx > 0) {
        if (!start.nearLeftEdge) return
        handlers.onSwipeRight?.()
      } else {
        if (!start.nearRightEdge) return
        handlers.onSwipeLeft?.()
      }
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
    ignoreInteractive,
    threshold
  ])
}
