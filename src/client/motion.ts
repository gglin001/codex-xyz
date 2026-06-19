import type { Variants } from "framer-motion"

export const smoothSpring = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.8
} as const

export const softSpring = {
  type: "spring",
  stiffness: 360,
  damping: 34,
  mass: 0.85
} as const

export const quickEase = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1]
} as const

export const panelPresence: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.99 }
}

export const fadePresence: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
}

export const listItemPresence: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 }
}

export const revealPresence: Variants = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 }
}
