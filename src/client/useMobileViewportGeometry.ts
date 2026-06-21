import { useEffect } from "react"

type VirtualKeyboardNavigator = Navigator & {
  virtualKeyboard?: EventTarget & {
    boundingRect?: {
      height: number
    }
  }
}

const appVisualHeightProperty = "--app-visual-height"
const keyboardInsetProperty = "--keyboard-inset-bottom"
const keyboardVisibleAttribute = "data-keyboard-visible"
const mobileViewportQuery = "(max-width: 767px)"
const keyboardVisibilityThreshold = 80

function setKeyboardState(insetValue: number) {
  const inset = Math.max(0, Math.round(insetValue > keyboardVisibilityThreshold ? insetValue : 0))
  document.documentElement.style.setProperty(keyboardInsetProperty, `${inset}px`)
  document.documentElement.toggleAttribute(keyboardVisibleAttribute, inset > 0)
}

function setAppVisualHeight(heightValue: number | null) {
  if (heightValue === null) {
    document.documentElement.style.setProperty(appVisualHeightProperty, "100dvh")
    return
  }
  document.documentElement.style.setProperty(appVisualHeightProperty, `${Math.max(320, Math.round(heightValue))}px`)
}

function visualViewportKeyboardInset() {
  const viewport = window.visualViewport
  if (!viewport) {
    return 0
  }

  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

function virtualKeyboardInset(virtualKeyboard: VirtualKeyboardNavigator["virtualKeyboard"]) {
  return virtualKeyboard?.boundingRect?.height ?? 0
}

function visibleViewportHeight(keyboardInset: number) {
  const viewport = window.visualViewport
  const viewportHeight = viewport?.height ?? window.innerHeight

  if (viewport && visualViewportKeyboardInset() > keyboardVisibilityThreshold) {
    return viewportHeight
  }

  if (keyboardInset > keyboardVisibilityThreshold) {
    return window.innerHeight - keyboardInset
  }

  return viewportHeight
}

export function useMobileViewportGeometry() {
  useEffect(() => {
    const mobileQuery = window.matchMedia(mobileViewportQuery)
    const viewport = window.visualViewport
    const virtualKeyboard = (window.navigator as VirtualKeyboardNavigator).virtualKeyboard
    let frame: number | null = null

    const commit = () => {
      frame = null

      if (!mobileQuery.matches) {
        setAppVisualHeight(null)
        setKeyboardState(0)
        return
      }

      const keyboardInset = Math.max(
        visualViewportKeyboardInset(),
        virtualKeyboardInset(virtualKeyboard)
      )
      setKeyboardState(keyboardInset)
      setAppVisualHeight(visibleViewportHeight(keyboardInset))
    }

    const schedule = () => {
      if (frame !== null) {
        return
      }
      frame = window.requestAnimationFrame(commit)
    }

    schedule()
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)
    virtualKeyboard?.addEventListener("geometrychange", schedule)
    window.addEventListener("resize", schedule)
    mobileQuery.addEventListener("change", schedule)

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
      virtualKeyboard?.removeEventListener("geometrychange", schedule)
      window.removeEventListener("resize", schedule)
      mobileQuery.removeEventListener("change", schedule)
      setAppVisualHeight(null)
      setKeyboardState(0)
    }
  }, [])
}
