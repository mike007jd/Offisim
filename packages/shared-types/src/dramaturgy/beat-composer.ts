import type { ActivityKind, AgentRunEvent, RunFailureKind, WorkKind } from '../events/agent-run.js';
import type { InteractionAnchorKind } from './staging.js';

/** A staged beat. Affordance is a target *kind*, not coordinates. */
export type BeatKind =
  | 'receive-task'
  | 'plan'
  | 'delegate'
  | 'research'
  | 'produce'
  | 'compute'
  | 'review'
  | 'approval'
  | 'failure'
  | 'cancelled'
  | 'join'
  | 'complete'
  | 'activity';

/** Interaction anchor kind a beat targets (resolved to real anchors via staging). */
export type BeatAffordance = InteractionAnchorKind;
export type VisualPhase =
  | 'plan'
  | 'read'
  | 'produce'
  | 'compute'
  | 'review'
  | 'wait'
  | 'blocked'
  | 'complete';
export type VisualEmotion =
  | 'neutral'
  | 'focus'
  | 'thinking'
  | 'worried'
  | 'blocked'
  | 'confident'
  | 'celebrating'
  | 'urgent';
export type VisualProp = 'document' | 'laptop' | 'terminal' | 'package' | 'pointer' | 'archive';

export interface FlowIntent {
  readonly kind: 'task' | 'delegation' | 'tool' | 'artifact' | 'approval' | 'failure' | 'join';
  readonly label: string;
  readonly target: 'workstation' | 'tool' | 'review' | 'delivery' | 'user';
  readonly pulse: boolean;
}

export interface ArtifactIntent {
  readonly title: string;
  readonly kind: string;
  readonly ref?: string;
  readonly deliverableId?: string;
  readonly path?: string;
}

/** Resource-strain vocabulary — 1:1 with the typed wire failure kind. */
export type ResourceKind = RunFailureKind;
export type ResourceSeverity = 'warning' | 'blocked' | 'exhausted' | 'recovering';

/**
 * The three severities the UI surfaces for a resource strain. `recovering`
 * collapses to `warning` — it is a transient, non-blocking state. Shared so the
 * office projection, scene markers, and drilldown all rank strain identically.
 */
export type SurfacedResourceSeverity = 'warning' | 'blocked' | 'exhausted';

export interface ResourceIntent {
  readonly kind: ResourceKind;
  readonly severity: ResourceSeverity;
  readonly label: string;
}

export interface VisualIntent {
  readonly phase: VisualPhase;
  readonly intensity: 0 | 1 | 2 | 3;
  readonly emotion: VisualEmotion;
  readonly prop?: VisualProp;
  readonly affordance: BeatAffordance | null;
  readonly badges: readonly string[];
}

export interface SceneBeat {
  readonly id: string;
  readonly kind: BeatKind;
  readonly priority: number;
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly employeeId: string | null;
  readonly workKind: WorkKind | null;
  readonly activityKind: ActivityKind | null;
  readonly affordance: BeatAffordance | null;
  /** Whether the actor relocates for this beat (subject to movement cooldown). */
  readonly movement: boolean;
  /** Part of a same-root parallel fan-out. */
  readonly parallel: boolean;
  /** High-priority beat that bypasses cooldowns (approval / failure / cancelled). */
  readonly interrupt: boolean;
  /** Deterministic, seed-derived variant index. */
  readonly variant: number;
  readonly visual: VisualIntent;
  readonly flow: FlowIntent | null;
  readonly artifact: ArtifactIntent | null;
  readonly resource: ResourceIntent | null;
  readonly at: number;
  /**
   * Beat lifetime so the office can expire a beat without waiting for a future
   * event (an idle actor returns home). Pure: derived from `at` + a per-kind TTL,
   * never wall-clock, so replay stays byte-identical. Approval/failure get a long
   * TTL — they persist until a later event resolves them, not on a short timer.
   */
  readonly lifecycle: { readonly startedAt: number; readonly endsAt: number };
}

/**
 * Timing rules in ms (source plan §9.3).
 *
 * Two plan constants are intentionally folded away:
 *  - `coalesceWindowMs` (800ms): subsumed by `microMinMs` — a same-kind activity
 *    stream coalesces (no new micro beat) for any gap up to the micro minimum,
 *    which is strictly wider, so the 800ms window added nothing and (when used
 *    as the only extend threshold) silently defeated sustained relocation for
 *    realistic 0.8–2.5s tool loops.
 *  - `majorMinMs` (6000ms): major beats are real, infrequent events
 *    (delegate/join/complete) that must not be dropped; movement-cooldown +
 *    coalescing already prevent churn.
 */
export interface DramaturgyTiming {
  /** A same-kind activity stream coalesces (and accumulates toward one
   *  relocation) while consecutive gaps stay within this window. */
  readonly microMinMs: number;
  readonly movementCooldownMs: number;
  readonly sustainedRelocationMs: number;
}

export interface DramaturgyConfig {
  readonly dramaturgyVersion: string;
  readonly timing?: Partial<DramaturgyTiming>;
  /** Variant count per beat kind (default 3). */
  readonly variantCount?: number;
}

export type TimedAgentRunEvent = AgentRunEvent & { readonly timestamp: number };
