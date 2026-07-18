import type { ActivityKind, AgentRunEvent, RunFailureKind, WorkKind } from '../events/agent-run.js';
import type { InteractionAnchorKind } from './staging.js';

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

export type ResourceKind = RunFailureKind;
export type ResourceSeverity = 'warning' | 'blocked' | 'exhausted' | 'recovering';
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
  readonly movement: boolean;
  readonly parallel: boolean;
  readonly interrupt: boolean;
  readonly variant: number;
  readonly visual: VisualIntent;
  readonly flow: FlowIntent | null;
  readonly artifact: ArtifactIntent | null;
  readonly resource: ResourceIntent | null;
  readonly at: number;
  readonly lifecycle: { readonly startedAt: number; readonly endsAt: number };
}

export interface DramaturgyTiming {
  readonly microMinMs: number;
  readonly movementCooldownMs: number;
  readonly sustainedRelocationMs: number;
}

export interface DramaturgyConfig {
  readonly dramaturgyVersion: string;
  readonly timing?: Partial<DramaturgyTiming>;
  readonly variantCount?: number;
}

export type TimedAgentRunEvent = AgentRunEvent & { readonly timestamp: number };
