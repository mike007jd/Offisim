/**
 * Mission → office-beat projection (M3 UX-007, PRD §24.4).
 *
 * The Office Theater is ONLY a projection of neutral events. This module maps a
 * Mission's lifecycle signals onto the EXISTING dramaturgy {@link SceneBeat}
 * vocabulary — it does not own mission state, does not generate an action
 * timeline, and never decides causality between role movement and execution. The
 * projector is pure: a mission event in → a beat (or null) out, with no mutation
 * of any mission record.
 *
 * It reuses the same beat type, {@link BEAT_PRIORITY} bands, and per-kind
 * lifecycle/expiry as the agent-run beat composer (it does NOT fork a parallel
 * beat system). The office consumes mission beats as one more READ-ONLY input
 * into its existing beat stream — a plain chat with no mission events stages
 * exactly as before.
 *
 * Accessibility (§24.4 / §29): every beat carries a stable `semanticLabel` +
 * `phase` so reduced-motion (which clears only the relocation anchor) still
 * conveys the meaning — planning / verification / failure / completion are
 * legible without any animation.
 */
import { BEAT_PRIORITY, type BeatKind, type SceneBeat, beatLifespanMs } from './beat-composer.js';

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

/**
 * The fixed mission-kind → (beat kind, phase, label, movement) table. This is
 * the §24.4 contract made data: planning/research/implementation → a planning
 * phase beat at the board; submit/verifying → a verification (review) beat;
 * fail/failed → a failure beat; awaiting_user → an approval beat; completed → a
 * completion beat. The chosen `BeatKind`s are all existing ones (no new beat
 * vocabulary), and `affordance`/`movement` follow the same conventions the
 * agent-run composer uses for those kinds.
 */
const MISSION_BEAT: Readonly<
  Record<
    MissionLifecycleKind,
    {
      readonly beatKind: BeatKind;
      readonly phase: MissionBeatPhase;
      readonly label: string;
      readonly priority: number;
      readonly affordance: SceneBeat['affordance'];
      readonly movement: boolean;
      readonly interrupt: boolean;
    }
  >
> = {
  'mission.running': {
    beatKind: 'plan',
    phase: 'planning',
    label: 'Planning the mission',
    priority: BEAT_PRIORITY.phase,
    affordance: 'board-presenter',
    movement: true,
    interrupt: false,
  },
  'mission.evaluation.submitted': {
    beatKind: 'review',
    phase: 'verification',
    label: 'Verifying acceptance criteria',
    priority: BEAT_PRIORITY.delegation,
    affordance: 'standing-review',
    movement: true,
    interrupt: false,
  },
  'mission.verifying': {
    beatKind: 'review',
    phase: 'verification',
    label: 'Verifying the mission',
    priority: BEAT_PRIORITY.delegation,
    affordance: 'standing-review',
    movement: true,
    interrupt: false,
  },
  'mission.evaluation.failed': {
    beatKind: 'failure',
    phase: 'failure',
    label: 'A criterion failed verification',
    priority: BEAT_PRIORITY.failure,
    affordance: null,
    movement: false,
    interrupt: true,
  },
  'mission.awaiting_user': {
    beatKind: 'approval',
    phase: 'approval',
    label: 'Waiting for your decision',
    priority: BEAT_PRIORITY.approval,
    affordance: null,
    movement: false,
    interrupt: true,
  },
  'mission.failed': {
    beatKind: 'failure',
    phase: 'failure',
    label: 'The mission failed',
    priority: BEAT_PRIORITY.failure,
    affordance: null,
    movement: false,
    interrupt: true,
  },
  'mission.completed': {
    beatKind: 'complete',
    phase: 'completion',
    label: 'The mission completed',
    priority: BEAT_PRIORITY.phase,
    affordance: 'board-presenter',
    movement: true,
    interrupt: false,
  },
};

/**
 * Project ONE neutral mission lifecycle event onto the office beat vocabulary.
 *
 * Pure: it reads the event and returns a beat (+ a11y label/phase), never
 * touching mission state. Returns null for any kind with no office meaning so a
 * plain chat (no mission events) is byte-identical to before — the office only
 * gains beats when real mission signals arrive.
 *
 * The beat's id is namespaced (`mission:<missionId>:<kind>:<at>`) so a mission
 * beat can never collide with an agent-run beat (`<runId>:<kind>:<index>`) in
 * the merged office stream, and its lifecycle uses the SAME per-kind TTL as the
 * agent-run composer (approval/failure persist until a later event resolves
 * them; phase beats expire on the shared timer).
 */
export function projectMissionEventToBeat(
  event: MissionLifecycleEvent,
): MissionBeatProjection | null {
  const map = MISSION_BEAT[event.kind];
  if (!map) return null;

  const beat: SceneBeat = {
    id: `mission:${event.missionId}:${event.kind}:${event.at}`,
    kind: map.beatKind,
    priority: map.priority,
    threadId: event.threadId,
    rootRunId: event.rootRunId ?? event.missionId,
    // The mission id is the run id when no attempt run is known, so the beat is
    // always self-identifying without inventing an employee or a fake run.
    runId: event.rootRunId ?? event.missionId,
    employeeId: event.employeeId ?? null,
    workKind: null,
    activityKind: null,
    affordance: map.affordance,
    movement: map.movement,
    parallel: false,
    interrupt: map.interrupt,
    // Mission beats carry no random variant (no per-actor visual loop to break);
    // a fixed 0 keeps the projection byte-deterministic.
    variant: 0,
    at: event.at,
    lifecycle: { startedAt: event.at, endsAt: event.at + beatLifespanMs(map.beatKind) },
  };

  return { beat, semanticLabel: map.label, phase: map.phase };
}

/**
 * Project an ordered mission lifecycle stream into beats, dropping the events
 * that stage nothing. A thin convenience over {@link projectMissionEventToBeat}
 * for the renderer beat source + harness — still pure, still read-only.
 */
export function projectMissionEvents(
  events: readonly MissionLifecycleEvent[],
): MissionBeatProjection[] {
  const out: MissionBeatProjection[] = [];
  for (const event of events) {
    const projected = projectMissionEventToBeat(event);
    if (projected) out.push(projected);
  }
  return out;
}
