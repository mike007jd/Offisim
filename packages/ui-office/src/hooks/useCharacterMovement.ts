/**
 * useCharacterMovement — drives character walking in the 3D scene.
 *
 * All mutations happen on refs inside useFrame; zero React re-renders.
 * Uses direct linear interpolation with arrival deceleration.
 *
 * API: call moveTo() on the returned handle to command a character
 * to walk to a target position. The hook drives position, facing
 * direction, and limb walk-cycle animation each frame.
 *
 * Coexists with useAgentAnimation: this hook writes group.position.x/z
 * and limb rotations; useAgentAnimation writes group.position.y (breathing),
 * group.rotation (tilt), group.scale, and ring material. No conflicts.
 */

import { useFrame } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import type * as THREE from 'three';

// ── Movement target (set via ref, zero re-renders) ──────────────

interface MovementTarget {
  /** World position to walk toward [x, y, z]. */
  dest: [number, number, number];
  /** Movement speed in units/second. */
  speed: number;
  /** Callback when character arrives at destination. */
  onArrive?: () => void;
}

// ── Limb refs for walk cycle animation ──────────────────────────

export interface CharacterLimbRefs {
  leftLeg: React.RefObject<THREE.Mesh | null>;
  rightLeg: React.RefObject<THREE.Mesh | null>;
  leftArm: React.RefObject<THREE.Mesh | null>;
  rightArm: React.RefObject<THREE.Mesh | null>;
}

// ── Constants ───────────────────────────────────────────────────

/** Distance threshold to consider "arrived". */
const ARRIVE_THRESHOLD = 0.15;
/** Distance at which deceleration begins. */
const DECEL_DISTANCE = 0.5;
/** Walk cycle frequency (radians/second). */
const WALK_FREQ = 8;
/** Leg swing amplitude (radians). */
const LEG_SWING = 0.4;
/** Arm swing amplitude (radians). */
const ARM_SWING = 0.3;
/** Body counter-rotate amplitude (radians) — torso reacts opposite to leg. */
const BODY_COUNTER_ROTATE = 0.06;
/** Walk bob vertical amplitude (m) — body lifts at mid-stride. */
const WALK_BOB_AMP = 0.03;
/** Squash duration after arrival (seconds). */
const SQUASH_DURATION = 0.3;
/** Anticipate duration on movement start (seconds). */
const ANTICIPATE_DURATION = 0.12;

// ── Hook ────────────────────────────────────────────────────────

export interface CharacterMovementHandle {
  /** Command the character to walk to a destination. */
  moveTo: (dest: [number, number, number], speed?: number, onArrive?: () => void) => void;
  /** Instantly place the character at a destination without animating. */
  teleportTo?: (dest: [number, number, number]) => void;
  /** Stop movement immediately. */
  stop: () => void;
  /** Whether the character is currently moving. */
  isMoving: () => boolean;
  /** Current world position of the character root. */
  getPosition: () => [number, number, number] | null;
}

/**
 * Drives per-frame walking animation for one character.
 *
 * @param groupRef - The character's root group (position mutated directly)
 * @param limbRefs - Optional limb mesh refs for walk cycle (legs/arms swing)
 */
export function useCharacterMovement(
  groupRef: React.RefObject<THREE.Group | null>,
  limbRefs?: CharacterLimbRefs | null,
): CharacterMovementHandle {
  const targetRef = useRef<MovementTarget | null>(null);
  const walkTimeRef = useRef(0);
  const squashRef = useRef(0); // >0 means squash animation in progress
  const anticipateRef = useRef(0); // >0 means anticipate-before-step in progress

  const moveTo = useCallback((dest: [number, number, number], speed = 4, onArrive?: () => void) => {
    targetRef.current = { dest, speed, onArrive };
    squashRef.current = 0;
    anticipateRef.current = ANTICIPATE_DURATION;
  }, []);

  const teleportTo = useCallback(
    (dest: [number, number, number]) => {
      const group = groupRef.current;
      if (!group) return;
      targetRef.current = null;
      walkTimeRef.current = 0;
      squashRef.current = 0;
      group.position.set(dest[0], dest[1], dest[2]);
      if (limbRefs) {
        resetLimbs(limbRefs);
      }
    },
    [groupRef, limbRefs],
  );

  const stop = useCallback(() => {
    targetRef.current = null;
    walkTimeRef.current = 0;
    // Reset limbs
    if (limbRefs) {
      resetLimbs(limbRefs);
    }
  }, [limbRefs]);

  const isMoving = useCallback(() => targetRef.current !== null, []);
  const getPosition = useCallback(() => {
    const group = groupRef.current;
    if (!group) return null;
    return [group.position.x, group.position.y, group.position.z] as [number, number, number];
  }, [groupRef]);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;

    // Cap delta to prevent teleporting when tab returns from background
    const clampedDelta = Math.min(delta, 0.05);

    // ── Squash animation (post-arrival) ──
    if (squashRef.current > 0) {
      squashRef.current -= clampedDelta;
      const t = Math.max(0, squashRef.current / SQUASH_DURATION);
      const squashY = 1 - 0.05 * Math.sin(t * Math.PI); // 0.95 → 1.0
      g.scale.y = squashY;
      if (squashRef.current <= 0) {
        g.scale.y = 1;
        g.rotation.z = 0;
      }
      return;
    }

    const target = targetRef.current;
    if (!target) {
      // Hand control back: clear any walk-cycle body roll left over.
      if (Math.abs(g.rotation.z) > 0.001) {
        g.rotation.z += (0 - g.rotation.z) * Math.min(1, clampedDelta * 6);
      }
      return;
    }

    const { dest, speed, onArrive } = target;

    // ── Compute distance to destination ──
    const dx = dest[0] - g.position.x;
    const dz = dest[2] - g.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVE_THRESHOLD) {
      // Arrived
      g.position.x = dest[0];
      g.position.z = dest[2];
      targetRef.current = null;
      walkTimeRef.current = 0;
      anticipateRef.current = 0;
      g.rotation.z = 0;

      // Reset limbs to neutral
      if (limbRefs) resetLimbs(limbRefs);

      // Squash landing
      squashRef.current = SQUASH_DURATION;

      onArrive?.();
      return;
    }

    // ── Anticipate (slight backwards lean on first 120ms) ──
    let anticipateScale = 1;
    if (anticipateRef.current > 0) {
      anticipateRef.current = Math.max(0, anticipateRef.current - clampedDelta);
      anticipateScale = 1 - anticipateRef.current / ANTICIPATE_DURATION;
    }

    // ── Move toward destination ──
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // Deceleration near arrival
    const speedMul = dist < DECEL_DISTANCE ? dist / DECEL_DISTANCE : 1;
    const step = speed * speedMul * clampedDelta * anticipateScale;
    const actualStep = Math.min(step, dist);

    g.position.x += dirX * actualStep;
    g.position.z += dirZ * actualStep;

    // Face movement direction
    g.rotation.y = Math.atan2(dirX, dirZ);

    // ── Walk cycle animation ──
    walkTimeRef.current += clampedDelta;
    const t = walkTimeRef.current;

    // Walk bob: body lifts twice per stride, so frequency is 2× WALK_FREQ.
    const walkBob = Math.abs(Math.sin(t * WALK_FREQ)) * WALK_BOB_AMP * anticipateScale;
    g.position.y = walkBob;
    // Torso counter-rotates opposite to leg swing.
    g.rotation.z = -Math.sin(t * WALK_FREQ) * BODY_COUNTER_ROTATE * anticipateScale;

    if (limbRefs) {
      const legAngle = Math.sin(t * WALK_FREQ) * LEG_SWING * anticipateScale;
      const armAngle = Math.sin(t * WALK_FREQ) * ARM_SWING * anticipateScale;

      if (limbRefs.leftLeg.current) limbRefs.leftLeg.current.rotation.x = legAngle;
      if (limbRefs.rightLeg.current) limbRefs.rightLeg.current.rotation.x = -legAngle;
      if (limbRefs.leftArm.current) limbRefs.leftArm.current.rotation.x = -armAngle;
      if (limbRefs.rightArm.current) limbRefs.rightArm.current.rotation.x = armAngle;
    }
  });

  // Memoize handle to prevent re-registration churn in EmployeeMarker
  return useMemo(
    () => ({ moveTo, teleportTo, stop, isMoving, getPosition }),
    [moveTo, teleportTo, stop, isMoving, getPosition],
  );
}

function resetLimbs(refs: CharacterLimbRefs) {
  if (refs.leftLeg.current) refs.leftLeg.current.rotation.x = 0;
  if (refs.rightLeg.current) refs.rightLeg.current.rotation.x = 0;
  if (refs.leftArm.current) refs.leftArm.current.rotation.x = 0;
  if (refs.rightArm.current) refs.rightArm.current.rotation.x = 0;
}
