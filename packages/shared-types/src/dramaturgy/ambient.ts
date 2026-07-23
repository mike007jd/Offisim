import type { AmbientModePolicy } from './modes.js';
import type { CharacterPerformanceState } from './performance.js';
import type { ActorStaging, StagingPrefab } from './staging.js';

export type AmbientRoutineKind =
  | 'refreshment'
  | 'library'
  | 'social'
  | 'phone'
  | 'seated-shift'
  | 'desk-fidget'
  | 'look-around'
  | 'stretch';
export type AmbientActivityPhase = 'outbound' | 'dwell' | 'return';

export interface AmbientActorAvailability {
  readonly employeeId: string;
  /** A real run/beat/status/staging currently owns this employee. */
  readonly busy: boolean;
}

export interface AmbientActorHome {
  readonly employeeId: string;
  readonly x: number;
  readonly z: number;
  readonly facing?: number;
  readonly posture?: 'sitting' | 'standing';
}

export interface AmbientEmployeeClock {
  readonly employeeId: string;
  /** Number of due/attempt decisions already consumed. */
  readonly sequence: number;
  readonly nextDueAt: number;
}

export interface AmbientDestination {
  readonly anchorId: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly posture: 'standing';
}

export interface AmbientActivity {
  readonly moverId: string;
  readonly partnerId: string | null;
  readonly routine: AmbientRoutineKind;
  readonly sequence: number;
  readonly away: boolean;
  readonly destination: AmbientDestination | null;
  readonly homePosture: 'sitting' | 'standing';
  readonly startedAt: number;
  readonly outboundEndsAt: number;
  readonly dwellEndsAt: number;
  readonly endsAt: number;
}

export interface AmbientSchedulerState {
  readonly version: 'office-ambient-v2';
  readonly seed: string;
  readonly startedAt: number;
  readonly lastAdvancedAt: number;
  readonly geometrySignature: string;
  readonly clocks: readonly AmbientEmployeeClock[];
  readonly activities: readonly AmbientActivity[];
}

export interface AmbientSchedulerInput {
  readonly seed: string;
  readonly now: number;
  readonly actors: readonly AmbientActorAvailability[];
  readonly homes: readonly AmbientActorHome[];
  readonly prefabs: readonly StagingPrefab[];
  readonly blockedAnchorIds?: readonly string[];
  readonly policy: AmbientModePolicy;
  /** Renderer-supplied real route oracle; null means the target is unreachable. */
  readonly routeFor?: AmbientRoutePlanner;
  /** Stable revision of route bounds/obstacles; changes cancel active choreography. */
  readonly routeSignature?: string;
}

export interface AmbientRoutePoint {
  readonly x: number;
  readonly z: number;
}

export interface AmbientRouteRequest {
  readonly from: AmbientRoutePoint;
  readonly to: AmbientRoutePoint;
  /** Furniture interaction anchors may intentionally touch an inflated obstacle. */
  readonly allowBlockedTarget: boolean;
}

export interface AmbientRoutePlan {
  readonly distance: number;
}

export type AmbientRoutePlanner = (request: AmbientRouteRequest) => AmbientRoutePlan | null;

export interface AmbientActorDirection {
  readonly employeeId: string;
  readonly routine: AmbientRoutineKind;
  readonly phase: AmbientActivityPhase;
  readonly away: boolean;
  readonly partnerId: string | null;
  readonly performance: CharacterPerformanceState;
  readonly staging: ActorStaging | null;
}

export interface AmbientSchedulerSnapshot {
  readonly state: AmbientSchedulerState;
  readonly directions: readonly AmbientActorDirection[];
  /** Exact next due/phase boundary; Infinity means no timer is needed. */
  readonly nextWakeAt: number;
}
