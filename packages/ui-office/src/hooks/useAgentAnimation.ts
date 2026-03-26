/**
 * useAgentAnimation — drives per-frame mesh transforms and visual effect
 * parameters based on agent state.  All mutations happen on refs inside
 * useFrame; zero React re-renders.
 *
 * Uses frame-rate-independent exponential damping (1 - e^(-k*dt), same
 * approach as Unity SmoothDamp) and Math.sin for cyclic loops.
 *
 * Five visual tiers:
 *   idle     — slow breathing, no ring
 *   working  — assigned/thinking/searching/executing/reporting/meeting
 *   blocked  — blocked/waiting
 *   success  — green flash + bounce
 *   failed   — red flash + shake
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
    breathAmp: 0.025,
    breathSpeed: 2,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    ringColor: GRAY,
    ringOpacity: 0,
    ringPulseSpeed: 0,
    scale: 1,
  },

  // ── Working tier ──
  assigned: {
    breathAmp: 0.03,
    breathSpeed: 3,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    ringColor: BLUE,
    ringOpacity: 0.5,
    ringPulseSpeed: 3,
    scale: 1.06, // entrance bounce — damps back to 1.0 via the hook
  },
  thinking: {
    breathAmp: 0.04,
    breathSpeed: 1.5,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.15,
    lean: 0.05,
    ringColor: PURPLE,
    ringOpacity: 0.4,
    ringPulseSpeed: 1.5,
    scale: 1,
  },
  searching: {
    breathAmp: 0.03,
    breathSpeed: 2,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0.08,
    ringColor: PURPLE,
    ringOpacity: 0.45,
    ringPulseSpeed: 2.5,
    scale: 1,
  },
  executing: {
    breathAmp: 0.02,
    breathSpeed: 4,
    rockAmp: 0.03,
    rockSpeed: 3,
    headTilt: -0.05,
    lean: 0.06,
    ringColor: GREEN,
    ringOpacity: 0.5,
    ringPulseSpeed: 2,
    scale: 1,
  },
  reporting: {
    breathAmp: 0.025,
    breathSpeed: 2,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.05,
    lean: -0.04,
    ringColor: CYAN,
    ringOpacity: 0.5,
    ringPulseSpeed: 2.5,
    scale: 1,
  },
  meeting: {
    breathAmp: 0.03,
    breathSpeed: 2,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    ringColor: PURPLE,
    ringOpacity: 0.35,
    ringPulseSpeed: 1,
    scale: 1,
  },

  // ── Blocked tier ──
  blocked: {
    breathAmp: 0.035,
    breathSpeed: 1,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: -0.12,
    lean: -0.06,
    ringColor: AMBER,
    ringOpacity: 0.55,
    ringPulseSpeed: 0.8,
    scale: 1,
  },
  waiting: {
    breathAmp: 0.02,
    breathSpeed: 1.5,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0,
    lean: 0,
    ringColor: AMBER,
    ringOpacity: 0.25,
    ringPulseSpeed: 0.5,
    scale: 1,
  },

  // ── Success tier ──
  success: {
    breathAmp: 0.05,
    breathSpeed: 4,
    rockAmp: 0,
    rockSpeed: 0,
    headTilt: 0.1,
    lean: 0,
    ringColor: GREEN,
    ringOpacity: 0.7,
    ringPulseSpeed: 4,
    scale: 1.08,
  },

  // ── Failed tier ──
  failed: {
    breathAmp: 0.02,
    breathSpeed: 1,
    rockAmp: 0.04,
    rockSpeed: 12,
    headTilt: -0.15,
    lean: 0,
    ringColor: RED,
    ringOpacity: 0.6,
    ringPulseSpeed: 0,
    scale: 0.97,
  },
};

const DEFAULT_PRESET: AnimPreset = {
  breathAmp: 0.025,
  breathSpeed: 2,
  rockAmp: 0,
  rockSpeed: 0,
  headTilt: 0,
  lean: 0,
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

/**
 * Drives per-frame animation for one agent character.
 *
 * Call this ONCE per EmployeeMarker.  The hook subscribes to useFrame
 * internally and mutates the provided refs directly — no state, no
 * re-renders.
 *
 * @param state - current agent state string (e.g. 'idle', 'executing')
 * @param refs  - Three.js object refs to mutate each frame
 */
export function useAgentAnimation(state: string, refs: AgentAnimationRefs): void {
  // Track current interpolated values in a plain object (not React state)
  const cur = useRef({
    posY: 0,
    posX: 0,
    rotY: 0,
    rotX: 0, // lean
    scale: 1,
    ringR: 0,
    ringG: 0,
    ringB: 0,
    ringOpacity: 0,
  });

  // Track previous state for entrance effects
  const prevState = useRef(state);

  useFrame((frameState, delta) => {
    const { groupRef, ringMatRef } = refs;
    if (!groupRef.current) return;

    const t = frameState.clock.elapsedTime;
    const preset = getPreset(state);

    // Detect state change for entrance effects
    const stateChanged = prevState.current !== state;
    if (stateChanged) {
      prevState.current = state;
      // For "assigned", give an immediate scale bump that will damp down
      if (state === 'assigned' || state === 'success') {
        cur.current.scale = preset.scale;
      }
    }

    // ── Target calculation ──
    // Cyclic animations: breathing + typing rock
    const breathCycle = Math.sin(t * preset.breathSpeed) * preset.breathAmp;
    const rockCycle = preset.rockAmp > 0 ? Math.sin(t * preset.rockSpeed) * preset.rockAmp : 0;

    // For failed state: rapid shake that decays
    const targetPosX = rockCycle;
    const targetPosY = breathCycle;
    const targetRotY =
      preset.headTilt +
      (state === 'searching'
        ? Math.sin(t * 1.2) * 0.12 // scanning left-right
        : 0);
    const targetRotX = preset.lean;

    // Scale: damp back toward 1.0 after entrance bounce
    const targetScale = stateChanged ? preset.scale : 1;

    // ── Smooth interpolation (frame-rate independent) ──
    const c = cur.current;
    // Use maath damp for each property individually
    // damp(current, target, smoothing, delta) returns void but mutates an array
    // For single values we do manual exponential damp:
    const factor = 1 - Math.exp(-SMOOTH * delta);

    c.posX += (targetPosX - c.posX) * factor;
    c.posY += (targetPosY - c.posY) * factor;
    c.rotY += (targetRotY - c.rotY) * factor;
    c.rotX += (targetRotX - c.rotX) * factor;
    c.scale += (targetScale - c.scale) * factor;

    // Ring color/opacity
    c.ringR += (preset.ringColor[0] - c.ringR) * factor;
    c.ringG += (preset.ringColor[1] - c.ringG) * factor;
    c.ringB += (preset.ringColor[2] - c.ringB) * factor;
    c.ringOpacity += (preset.ringOpacity - c.ringOpacity) * factor;

    // ── Apply to refs ──
    const g = groupRef.current;
    g.position.x = c.posX;
    g.position.y = c.posY;
    g.rotation.y = c.rotY;
    g.rotation.x = c.rotX;
    const s = c.scale;
    g.scale.set(s, s, s);

    // Ring
    if (ringMatRef.current) {
      const rm = ringMatRef.current;
      rm.color.setRGB(c.ringR, c.ringG, c.ringB);

      // Pulse modulation
      const pulse =
        preset.ringPulseSpeed > 0
          ? 0.5 + 0.5 * Math.sin(t * preset.ringPulseSpeed * Math.PI * 2)
          : 1;
      rm.opacity = c.ringOpacity * pulse;
      rm.visible = c.ringOpacity > 0.01;
    }
  });
}
