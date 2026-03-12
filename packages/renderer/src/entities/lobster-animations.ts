import gsap from 'gsap';
import type { Container, Graphics } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * Continuous idle bob — body container moves up/down by 1 logical pixel (3 screen px).
 * Returns a tween with yoyo + infinite repeat.
 */
export function createIdleBob(bodyContainer: Container, motion: MotionBucket): gsap.core.Tween {
  if (motion.duration <= 0) {
    // Reduced motion: return a no-op tween
    return gsap.to(bodyContainer, { duration: 0 });
  }
  return gsap.to(bodyContainer, {
    y: bodyContainer.position.y - 3, // 1 logical pixel up
    duration: motion.duration,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

/**
 * Claw wiggle — both claws rotate ±5° in opposite directions.
 * Returns a timeline with yoyo + infinite repeat.
 */
export function createClawWiggle(
  clawL: Graphics,
  clawR: Graphics,
  motion: MotionBucket,
): gsap.core.Timeline | gsap.core.Tween {
  if (motion.duration <= 0) {
    return gsap.to(clawL, { duration: 0 });
  }
  const tl = gsap.timeline({ repeat: -1, yoyo: true });
  tl.to(clawL, { rotation: 0.09, duration: motion.duration * 0.6, ease: 'sine.inOut' }, 0);
  tl.to(clawR, { rotation: -0.09, duration: motion.duration * 0.6, ease: 'sine.inOut' }, 0);
  return tl;
}

/**
 * Thinking animation — antennae wiggle faster, eyes shift up 1px.
 * Returns a timeline with infinite repeat.
 */
export function createThinkingAnimation(
  antennaL: Graphics,
  antennaR: Graphics,
  eyesGfx: Graphics,
  motion: MotionBucket,
): gsap.core.Timeline | gsap.core.Tween {
  if (motion.duration <= 0) {
    return gsap.to(antennaL, { duration: 0 });
  }
  const tl = gsap.timeline({ repeat: -1, yoyo: true });
  tl.to(antennaL, { rotation: 0.15, duration: motion.duration * 0.4, ease: 'sine.inOut' }, 0);
  tl.to(antennaR, { rotation: -0.15, duration: motion.duration * 0.4, ease: 'sine.inOut' }, 0);
  tl.to(
    eyesGfx,
    { y: eyesGfx.position.y - 2, duration: motion.duration * 0.5, ease: 'sine.inOut' },
    0,
  );
  return tl;
}

/**
 * Working animation — fast claw wiggle (claws "type" on desk).
 * Faster than regular claw wiggle.
 */
export function createWorkingAnimation(
  clawL: Graphics,
  clawR: Graphics,
  motion: MotionBucket,
): gsap.core.Timeline | gsap.core.Tween {
  if (motion.duration <= 0) {
    return gsap.to(clawL, { duration: 0 });
  }
  const tl = gsap.timeline({ repeat: -1, yoyo: true });
  tl.to(clawL, { rotation: 0.12, duration: motion.duration * 0.3, ease: 'power1.inOut' }, 0);
  tl.to(clawR, { rotation: -0.12, duration: motion.duration * 0.3, ease: 'power1.inOut' }, 0.05);
  return tl;
}

/** ANIM-008: Searching — eyes scan left-right, antennae point forward */
export function createSearchingAnimation(
  eyes: Container,
  antennaL: Container,
  antennaR: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline({ repeat: -1 });
  const eyeBaseX = eyes.position.x;
  tl.to(eyes, { x: eyeBaseX - 4, duration: 0.6, ease: 'sine.inOut' });
  tl.to(eyes, { x: eyeBaseX + 4, duration: 1.2, ease: 'sine.inOut' });
  tl.to(eyes, { x: eyeBaseX, duration: 0.6, ease: 'sine.inOut' });
  // Antennae lean forward (must be on timeline to avoid orphaned tweens on state switch)
  tl.to(antennaL, { rotation: -0.15, duration: 0.4, ease: 'sine.out' }, 0);
  tl.to(antennaR, { rotation: 0.15, duration: 0.4, ease: 'sine.out' }, 0);
  return tl;
}

/** ANIM-010: Blocked — claws fold inward, tiny jitter */
export function createBlockedAnimation(
  clawL: Container,
  clawR: Container,
  body: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline({ repeat: -1 });
  const baseX = body.position.x;
  // Claws fold inward (defensive) — must be on timeline to avoid orphaned tweens
  tl.to(clawL, { rotation: 0.3, duration: 0.3, ease: 'power2.out' }, 0);
  tl.to(clawR, { rotation: -0.3, duration: 0.3, ease: 'power2.out' }, 0);
  // Tiny jitter
  tl.to(body, { x: baseX + 1, duration: 0.15, ease: 'none' });
  tl.to(body, { x: baseX - 1, duration: 0.15, ease: 'none' });
  tl.to(body, { x: baseX, duration: 0.15, ease: 'none' });
  return tl;
}

/** ANIM-011: Waiting — subtle breathe, low energy */
export function createWaitingAnimation(body: Container, motion: MotionBucket): gsap.core.Tween {
  if (motion.duration === 0) return gsap.to({}, { duration: 0 });
  return gsap.to(body.scale, {
    x: 1.01,
    y: 1.01,
    duration: 1.5,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

/** ANIM-012: Reporting — brief upward float */
export function createReportingAnimation(body: Container, motion: MotionBucket): gsap.core.Tween {
  if (motion.duration === 0) return gsap.to({}, { duration: 0 });
  return gsap.to(body, {
    y: body.position.y - 2,
    duration: motion.duration,
    ease: motion.ease,
    yoyo: true,
    repeat: -1,
  });
}

/** ANIM-013: Success — claws open wide briefly */
export function createSuccessAnimation(
  clawL: Container,
  clawR: Container,
  motion: MotionBucket,
): gsap.core.Timeline {
  if (motion.duration === 0) return gsap.timeline();
  const tl = gsap.timeline();
  tl.to(clawL, { rotation: -0.5, duration: 0.15, ease: 'back.out(2)' });
  tl.to(clawR, { rotation: 0.5, duration: 0.15, ease: 'back.out(2)' }, '<');
  tl.to(clawL, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, '+=0.2');
  tl.to(clawR, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, '<');
  return tl;
}
