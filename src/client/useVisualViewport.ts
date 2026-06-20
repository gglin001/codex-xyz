import { useCallback, useEffect, useRef, useState } from "react"

export type VisualViewportHeightOptions = {
  maxWidth?: number
}

/**
 * Returns the current visual viewport height in CSS pixels, or null when the
 * API is unavailable (SSR / non-visual contexts).  On mobile this value shrinks
 * while the virtual keyboard is visible so the app can size its root container
 * to the remaining visible area.
 *
 * Throttled to at most one update per animation frame so rapid iOS keyboard
 * resize/scroll events do not trigger a React render cascade on every event.
 */
export function useVisualViewportHeight(options: VisualViewportHeightOptions = {}) {
  const { maxWidth } = options
  const [height, setHeight] = useState<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const latestRef = useRef<number | null>(null)

  const measure = useCallback(() => {
    const vv = window.visualViewport
    if (!vv) return
    if (maxWidth !== undefined && window.innerWidth > maxWidth) {
      latestRef.current = null
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        setHeight(null)
      })
      return
    }
    latestRef.current = vv.height
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      setHeight(latestRef.current)
    })
  }, [maxWidth])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    measure()
    vv.addEventListener("resize", measure)
    vv.addEventListener("scroll", measure)
    window.addEventListener("resize", measure)
    return () => {
      vv.removeEventListener("resize", measure)
      vv.removeEventListener("scroll", measure)
      window.removeEventListener("resize", measure)
    }
  }, [measure])

  return height
}
