import type { CharacterPerformanceState } from '@offisim/shared-types';
import type { PathPoint } from './scene-pathfinding.js';

export type CharacterMovementPhase = 'idle' | 'sit-exit' | 'walk';
export type CharacterMoveOrigin = 'settled' | 'drop-return' | 'entry';

export interface CharacterMovePlan {
  readonly phase: CharacterMovementPhase;
  readonly waypoints: readonly PathPoint[];
  readonly snapToTarget: boolean;
  readonly blocked: boolean;
}

interface PlanCharacterMoveInput {
  readonly start: PathPoint;
  readonly target: PathPoint;
  readonly origin: CharacterMoveOrigin;
  readonly currentPhase: CharacterMovementPhase;
  readonly reducedMotion: boolean;
  readonly pathfinderAvailable: boolean;
  /** null means an available pathfinder proved that no route exists. */
  readonly routedWaypoints: readonly PathPoint[] | null;
}

/**
 * Pure movement state machine used by the live EmployeeUnit and the P2 oracle.
 * A standard target change owns an atomic sit-exit phase; changing the target
 * again may replan its route but cannot skip that phase. Drag returns and new
 * hires are already standing at an explicit source point, so they enter walk.
 */
export function planCharacterMove({
  start,
  target,
  origin,
  currentPhase,
  reducedMotion,
  pathfinderAvailable,
  routedWaypoints,
}: PlanCharacterMoveInput): CharacterMovePlan {
  const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
  if (reducedMotion || distance < 0.05) {
    return { phase: 'idle', waypoints: [target], snapToTarget: true, blocked: false };
  }

  if (pathfinderAvailable && (!routedWaypoints || routedWaypoints.length === 0)) {
    return { phase: 'idle', waypoints: [], snapToTarget: false, blocked: true };
  }

  const waypoints = pathfinderAvailable ? (routedWaypoints ?? []) : [target];
  const phase = origin === 'settled' ? (currentPhase === 'walk' ? 'walk' : 'sit-exit') : 'walk';
  return { phase, waypoints, snapToTarget: false, blocked: false };
}

/**
 * Make sit-exit selection invariant under live dramaturgy changes. Walk keeps
 * the destination prop/work gesture so clip-map can still choose carry.
 */
export function performanceForMovementPhase(
  performance: CharacterPerformanceState,
  phase: CharacterMovementPhase,
): CharacterPerformanceState {
  if (phase === 'sit-exit') {
    return {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: 'none',
      socialGesture: 'none',
      expression: 'neutral',
      intensity: 0,
    };
  }
  if (phase === 'walk') {
    return { ...performance, locomotion: 'walk', posture: 'stand' };
  }
  return performance;
}

/** Standing departures skip a nonexistent sit.exit; an active transition stays atomic. */
export function shouldPromoteSitExit(
  phase: CharacterMovementPhase,
  actualPosture: CharacterPerformanceState['posture'] | null,
  transitionPending: boolean,
): boolean {
  return phase === 'sit-exit' && actualPosture === 'stand' && !transitionPending;
}
