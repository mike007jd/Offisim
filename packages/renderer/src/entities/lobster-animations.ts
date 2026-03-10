import gsap from 'gsap';
import type { Container, Graphics } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * Continuous idle bob — body container moves up/down by 1 logical pixel (3 screen px).
 * Returns a tween with yoyo + infinite repeat.
 */
export function createIdleBob(
  bodyContainer: Container,
  motion: MotionBucket,
): gsap.core.Tween {
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
  tl.to(eyesGfx, { y: eyesGfx.position.y - 2, duration: motion.duration * 0.5, ease: 'sine.inOut' }, 0);
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
