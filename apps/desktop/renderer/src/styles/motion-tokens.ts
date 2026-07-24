/**
 * Motion for React mirror of motion.css. Values must remain pure literals;
 * scripts/harness-motion-tokens.mjs parses this file as text to lock both
 * sources to the same foundations.
 */
const MOTION_DURATION = {
  instant: 0.06,
  fast: 0.12,
  quick: 0.14,
  base: 0.18,
  slow: 0.26,
} as const;

const MOTION_EASE = {
  ease: [0.2, 0, 0, 1],
  spring: [0.22, 1, 0.36, 1],
} as const;

export const motionPresets = {
  surfaceEnter: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: MOTION_DURATION.quick,
      ease: MOTION_EASE.ease,
    },
  },
  pageFade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE.ease,
    },
  },
  detailPanel: {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE.spring,
    },
    exit: {
      opacity: 0,
      x: 16,
      transition: {
        duration: MOTION_DURATION.fast,
        ease: MOTION_EASE.ease,
      },
    },
  },
  // Fixed bottom-right overlays (first-run guide card/pill). WKWebView drops
  // the compositing layer of a fixed element that enters through an offscreen
  // translate, so entry is an in-place fade with only a tiny inner scale —
  // no positional movement. The pinned wrapper owns the layer (see
  // `.off-first-run-float` in onboarding.css).
  overlayCard: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE.spring,
    },
    exit: {
      opacity: 0,
      scale: 0.98,
      transition: {
        duration: MOTION_DURATION.fast,
        ease: MOTION_EASE.ease,
      },
    },
  },
} as const;
