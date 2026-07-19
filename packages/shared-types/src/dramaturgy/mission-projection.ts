import type { SceneBeat } from './beat-composer.js';

/**
 * The neutral mission lifecycle signal the office projects. A small, self-
 * describing envelope (no Tauri / no runtime / no mission-state handle) so the
 * pure projector, the renderer beat source, and a Node harness all share it.
 *
 * `kind` is the canonical mission lifecycle vocabulary — a subset that has a
 * visible office meaning per §24.4. Status transitions with no theatrical value
 * (e.g. `mission.ready`, `mission.paused`) are simply absent; the projector
 * returns null for anything it does not stage, never a fabricated beat.
 */
export type MissionLifecycleKind =
  /** A fresh attempt began running (planning / implementation phase). */
  | 'mission.running'
  /** The agent signaled a criterion is ready (submit_for_evaluation). */
  | 'mission.evaluation.submitted'
  /** Deterministic verification is in progress over the real workspace. */
  | 'mission.verifying'
  /** A criterion's deterministic verdict came back FAIL. */
  | 'mission.evaluation.failed'
  /** The mission needs the user (awaiting_user / a pending interaction). */
  | 'mission.awaiting_user'
  /** The mission terminated as failed/blocked (a product failure). */
  | 'mission.failed'
  /** The mission completed (every required criterion passed). */
  | 'mission.completed';

/** The user-legible mission phase a beat represents (the §24.4 phase set). */
export type MissionBeatPhase = 'planning' | 'verification' | 'approval' | 'failure' | 'completion';

/**
 * A neutral mission lifecycle event. Carries only its own identity + scope; it
 * is NOT a handle to mutate mission state (the projector cannot, by shape, write
 * back). `employeeId` is optional — a mission is a thread-level lifecycle, not an
 * actor, so most signals stage the mission director (no employee). When a mission
 * is bound to a single acting employee the producer MAY supply it so the office
 * stages that actor; absent means a director-level (employee-less) beat.
 */
export interface MissionLifecycleEvent {
  readonly kind: MissionLifecycleKind;
  readonly missionId: string;
  readonly threadId: string;
  /** The mission's attempt run id (== rootRunId of the attempt) when known. */
  readonly rootRunId?: string;
  /** Optional acting employee; absent = a director-level (mission) beat. */
  readonly employeeId?: string;
  /** Wall-clock-stamped time of the signal, in ms (the bus event timestamp). */
  readonly at: number;
}

/** The result of projecting one mission event: a beat plus its a11y metadata. */
export interface MissionBeatProjection {
  readonly beat: SceneBeat;
  /** Stable, render-mode-independent label for reduced-motion / screen readers. */
  readonly semanticLabel: string;
  readonly phase: MissionBeatPhase;
}
