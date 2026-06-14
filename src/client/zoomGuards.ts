export type PageZoomWheelEvent = {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  cancelable: boolean
  defaultPrevented: boolean
}

export type PageZoomGestureEvent = {
  cancelable: boolean
  defaultPrevented: boolean
}

const gestureZoomEventNames = ["gesturestart", "gesturechange"] as const
const activeCaptureOptions = { capture: true, passive: false } as const
const captureOptions = { capture: true } as const

export function shouldPreventPageZoomWheel(event: PageZoomWheelEvent) {
  if (event.defaultPrevented || !event.cancelable || event.altKey) {
    return false
  }

  return event.ctrlKey || event.metaKey
}

export function shouldPreventPageZoomGesture(event: PageZoomGestureEvent) {
  return event.cancelable && !event.defaultPrevented
}

export function installPageZoomGuards(target: Window) {
  const handleWheel = (event: WheelEvent) => {
    if (shouldPreventPageZoomWheel(event)) {
      event.preventDefault()
    }
  }

  const handleGesture = (event: Event) => {
    if (shouldPreventPageZoomGesture(event)) {
      event.preventDefault()
    }
  }

  target.addEventListener("wheel", handleWheel, activeCaptureOptions)
  for (const eventName of gestureZoomEventNames) {
    target.addEventListener(eventName, handleGesture, activeCaptureOptions)
  }

  return () => {
    target.removeEventListener("wheel", handleWheel, captureOptions)
    for (const eventName of gestureZoomEventNames) {
      target.removeEventListener(eventName, handleGesture, captureOptions)
    }
  }
}
