import { useCallback, useEffect, useState } from "react"

/**
 * Wraps the Fullscreen API with a reactive `isFullscreen` flag and a
 * `toggle` function.  `supported` is false during SSR or in browsers
 * that do not implement the Fullscreen API.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    setSupported(document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function")
    handler()
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function") {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Fullscreen was denied (e.g. missing user gesture or API unavailable).
    }
  }, [])

  return { isFullscreen, toggle, supported }
}
