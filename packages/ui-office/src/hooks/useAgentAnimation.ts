/**
 * useAgentAnimation — drives per-frame mesh transforms and visual effect
 * parameters based on agent state.  All mutations happen on refs inside
 * useFrame; zero React re-renders.
 *
 * Uses frame-rate-independent exponential damping (1 - e^(-k*dt), same
 * approach as Unity SmoothDamp) and Math.sin for cyclic loops.
 *
 * Five visual tiers:
 *   idle     — slow breathing + sway + weight-shift + occasional fidget
 *   working  — assigned/thinking/searching/executing/reporting/meeting
 *   blocked  — blocked/waiting
 *   success  — green flash + bounce
 *   failed   — red flash + shake
 *
 * Control hand-off: when an external movement handle reports isMoving(),
 * this hook releases position.x/y/z and rotation.z back to the movement
 * controller (walk bob + counter-rotate), keeping only scale/ring/lean.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type * as THREE from 'three';

// ── State → animation preset ──────────────────────────────────────

interface AnimPreset {
  /** Y-axis breathing amplitude */
  breathAmp: number;
  /** Breathing speed multiplier */
  breathSpeed: number;
  /** X-axis rock amplitude (typing motion) */
  rockAmp: number;
  /** Rock speed multiplier */
  rockSpeed: number;
  /** Head (group) Y-rotation offset */
  headTilt: number;
  /** Z-axis lean (forward = positive) */
  lean: number;
  /** Z-axis sway amplitude (idle "alive" weight shift) */
  swayAmp: number;
  /** Sway speed multiplier */
  swaySpeed: number;
  /** Status ring color [r, g, b] */
  ringColor: [number, number, number];
  /** Ring opacity (0 = hidden) */
  ringOpacity: number;
  /** Ring pulse speed (0 = no pulse) */
  ringPulseSpeed: number;
  /** Scale target */
  scale: number;
}

// Colors as [r, g, b] in 0–1 range
const BLUE: [number, number, number] = [0.23, 0.51, 0.96];
const PURPLE: [number, number, number] = [0.63, 0.55, 0.98];
const GREEN: [number, number, number] = [0.06, 0.73, 0.51];
const AMBER: [number, number, number] = [0.96, 0.62, 0.04];
const RED: [number, number, number] = [0.94, 0.27, 0.27];
const CYAN: [number, number, number] = [0.02, 0.71, 0.83];
const GRAY: [number, number, number] = [0.39, 0.45, 0.55];

const PRESETS: Record<string, AnimPreset> = {
  // ── Idle tier ──
  idle: {
    breathAmp: 0.06,
    breathSpeed: 1.5,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    swayAmp: 0.04,
    swaySpeed: 0.7,
    ringColor: GRAY,
    ringOpacity: 0,
    ringPulseSpeed: 0,
    scale: 1,
  },

  // ── Working tier ──
  assigned: {
    breathAmp: 0.04,
    breathSpeed: 2.4,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    swayAmp: 0.02,
    swaySpeed: 0.8,
    ringColor: BLUE,
    ringOpacity: 0.5,
    ringPulseSpeed: 3,
    scale: 1.06,
  },
  thinking: {
    breathAmp: 0.055,
    breathSpeed: 1.4,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.15,
    lean: 0.05,
    swayAmp: 0.025,
    swaySpeed: 0.55,
    ringColor: PURPLE,
    ringOpacity: 0.4,
    ringPulseSpeed: 1.5,
    scale: 1,
  },
  searching: {
    breathAmp: 0.04,
    breathSpeed: 1.8,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0.08,
    swayAmp: 0.03,
    swaySpeed: 0.9,
    ringColor: PURPLE,
    ringOpacity: 0.45,
    ringPulseSpeed: 2.5,
    scale: 1,
  },
  executing: {
    breathAmp: 0.028,
    breathSpeed: 3.5,
    rockAmp: 0.03,
    rockSpeed: 3,
    headTilt: -0.05,
    lean: 0.06,
    swayAmp: 0.012,
    swaySpeed: 1.2,
    ringColor: GREEN,
    ringOpacity: 0.5,
    ringPulseSpeed: 2,
    scale: 1,
  },
  reporting: {
    breathAmp: 0.04,
    breathSpeed: 2,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.05,
    lean: -0.04,
    swayAmp: 0.02,
    swaySpeed: 0.8,
    ringColor: CYAN,
    ringOpacity: 0.5,
    ringPulseSpeed: 2.5,
    scale: 1,
  },
  meeting: {
    breathAmp: 0.05,
    breathSpeed: 1.8,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    swayAmp: 0.035,
    swaySpeed: 0.6,
    ringColor: PURPLE,
    ringOpacity: 0.35,
    ringPulseSpeed: 1,
    scale: 1,
  },

  // ── Blocked tier ──
  blocked: {
    breathAmp: 0.05,
    breathSpeed: 0.9,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: -0.12,
    lean: -0.06,
    swayAmp: 0.05,
    swaySpeed: 0.5,
    ringColor: AMBER,
    ringOpacity: 0.55,
    ringPulseSpeed: 0.8,
    scale: 1,
  },
  waiting: {
    breathAmp: 0.04,
    breathSpeed: 1.3,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    swayAmp: 0.045,
    swaySpeed: 0.55,
    ringColor: AMBER,
    ringOpacity: 0.25,
    ringPulseSpeed: 0.5,
    scale: 1,
  },

  // ── Success tier ──
  success: {
    breathAmp: 0.07,
    breathSpeed: 3.5,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.1,
    lean: 0,
    swayAmp: 0.015,
    swaySpeed: 2.0,
    ringColor: GREEN,
    ringOpacity: 0.7,
    ringPulseSpeed: 4,
    scale: 1.08,
  },

  // ── Failed tier ──
  failed: {
    breathAmp: 0.03,
    breathSpeed: 1,
    rockAmp: 0.04,
    rockSpeed: 12,
    headTilt: -0.15,
    lean: 0,
    swayAmp: 0,
    swaySpeed: 0,
    ringColor: RED,
    ringOpacity: 0.6,
    ringPulseSpeed: 0,
    scale: 0.97,
  },
};

const DEFAULT_PRESET: AnimPreset = {
  breathAmp: 0.05,
  breathSpeed: 1.6,
  rockAmp: 0,
  rockSpeed: 0,
  headTilt: 0,
  lean: 0,
  swayAmp: 0.025,
  swaySpeed: 0.7,
  ringColor: GRAY,
  ringOpacity: 0,
  ringPulseSpeed: 0,
  scale: 1,
};

function getPreset(state: string): AnimPreset {
  return PRESETS[state] ?? DEFAULT_PRESET;
}

// ── Smoothing factor (higher = faster transition) ──
const SMOOTH = 4; // ~250ms to reach 90% of target

// ── Hook ──────────────────────────────────────────────────────────

export interface AgentAnimationRefs {
  /** Ref for the character group — hook mutates position/rotation/scale */
  groupRef: React.RefObject<THREE.Group | null>;
  /** Ref for the ring material — hook mutates color/opacity */
  ringMatRef: React.RefObject<THREE.MeshBasicMaterial | null>;
}

const WEIGHT_SHIFT_PERIOD_SEC = 6;
const WEIGHT_SHIFT_AMP = 0.012;
const FIDGET_PERIOD_SEC = 22;
const FIDGET_AMP_HEAD = 0.18;
const FIDGET_DURATION_SEC = 1.4;

/**
 * Drives per-frame animation for one agent character.
 *
 * Call this ONCE per EmployeeMarker. The hook subscribes to useFrame
 * internally and mutates the provided refs directly — no state, no
 * re-renders.
 *
 * @param state - current agent state string (e.g. 'idle', 'executing')
 * @param refs  - Three.js object refs to mutate each frame
 *
 * Note: this hook mutates the LowPolyCharacter's *inner* group; the outer
 * EmployeeMarker group (movement target) is animated by useCharacterMovement.
 * The two transforms compose so idle bob/sway and walk bob/counter-rotate
 * stack cleanly without fighting over a shared ref.
 */
export function useAgentAnimation(state: string, refs: AgentAnimationRefs): void {
  const cur = useRef({
    posY: 0,
    posX: 0,
    rotY: 0,
    rotX: 0, // lean
    rotZ: 0, // sway
    scale: 1,
    ringR: 0,
    ringG: 0,
    ringB: 0,
    ringOpacity: 0,
  });

  const prevState = useRef(state);
  const nextFidgetAtRef = useRef<number | null>(null);
  const phaseRef = useRef<number | null>(null);
  if (phaseRef.current === null) {
    phaseRef.current = Math.random() * Math.PI * 2;
  }

  useFrame((frameState, delta) => {
    const { groupRef, ringMatRef } = refs;
    if (!groupRef.current) return;

    const t = frameState.clock.elapsedTime;
    const preset = getPreset(state);
    const phase = phaseRef.current ?? 0;

    const stateChanged = prevState.current !== state;
    if (stateChanged) {
      prevState.current = state;
      if (state === 'assigned' || state === 'success') {
        cur.current.scale = preset.scale;
      }
    }

    // ── Sub-frame motion (double-frequency breath + secondary phase) ──
    const breathPrimary = Math.sin(t * preset.breathSpeed + phase) * preset.breathAmp;
    const breathSecondary =
      Math.sin(t * preset.breathSpeed * 0.43 + phase * 1.3) * preset.breathAmp * 0.4;
    const breathCycle = breathPrimary + breathSecondary;

    const rockCycle =
      preset.rockAmp > 0 ? Math.sin(t * preset.rockSpeed + phase) * preset.rockAmp : 0;

    // Weight-shift: 5-8s slow lateral lean (only meaningful when idle/still).
    const weightShift =
      Math.sin((t + phase) * ((Math.PI * 2) / WEIGHT_SHIFT_PERIOD_SEC)) * WEIGHT_SHIFT_AMP;

    // Sway: z-axis lean lerped from preset.
    const swayCycle =
      preset.swayAmp > 0 ? Math.sin(t * preset.swaySpeed + phase * 1.7) * preset.swayAmp : 0;

    // Fidget: occasional head tilt pulse every 20-30s while idle-like.
    if (nextFidgetAtRef.current === null) {
      nextFidgetAtRef.current = t + FIDGET_PERIOD_SEC * (0.7 + Math.random() * 0.6);
    }
    let fidgetTilt = 0;
    if (state === 'idle' && t >= (nextFidgetAtRef.current ?? Number.POSITIVE_INFINITY)) {
      const since = t - (nextFidgetAtRef.current ?? t);
      if (since < FIDGET_DURATION_SEC) {
        // Smooth pulse over the fidget window.
        const norm = since / FIDGET_DURATION_SEC;
        fidgetTilt = Math.sin(norm * Math.PI) * FIDGET_AMP_HEAD;
      } else {
        nextFidgetAtRef.current = t + FIDGET_PERIOD_SEC * (0.7 + Math.random() * 0.6);
      }
    }

    const targetPosX = rockCycle + weightShift;
    const targetPosY = breathCycle;
    const targetRotY =
      preset.headTilt + fidgetTilt + (state === 'searching' ? Math.sin(t * 1.2 + phase) * 0.12 : 0);
    const targetRotX = preset.lean;
    const targetRotZ = swayCycle;

    const targetScale = stateChanged ? preset.scale : 1;

    const c = cur.current;
    const factor = 1 - Math.exp(-SMOOTH * delta);

    c.posX += (targetPosX - c.posX) * factor;
    c.posY += (targetPosY - c.posY) * factor;
    c.rotY += (targetRotY - c.rotY) * factor;
    c.rotX += (targetRotX - c.rotX) * factor;
    c.rotZ += (targetRotZ - c.rotZ) * factor;
    c.scale += (targetScale - c.scale) * factor;

    c.ringR += (preset.ringColor[0] - c.ringR) * factor;
    c.ringG += (preset.ringColor[1] - c.ringG) * factor;
    c.ringB += (preset.ringColor[2] - c.ringB) * factor;
    c.ringOpacity += (preset.ringOpacity - c.ringOpacity) * factor;

    const g = groupRef.current;
    g.position.x = c.posX;
    g.position.y = c.posY;
    g.rotation.z = c.rotZ;
    g.rotation.y = c.rotY;
    g.rotation.x = c.rotX;
    const s = c.scale;
    g.scale.set(s, s, s);

    if (ringMatRef.current) {
      const rm = ringMatRef.current;
      rm.color.setRGB(c.ringR, c.ringG, c.ringB);
      const pulse =
        preset.ringPulseSpeed > 0
          ? 0.5 + 0.5 * Math.sin(t * preset.ringPulseSpeed * Math.PI * 2)
          : 1;
      rm.opacity = c.ringOpacity * pulse;
      rm.visible = c.ringOpacity > 0.01;
    }
  });
}
