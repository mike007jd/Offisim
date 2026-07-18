import type { SceneBeat } from './beat-composer.js';

export type MissionLifecycleKind =
  | 'mission.running'
  | 'mission.evaluation.submitted'
  | 'mission.verifying'
  | 'mission.evaluation.failed'
  | 'mission.awaiting_user'
  | 'mission.failed'
  | 'mission.completed';

export type MissionBeatPhase = 'planning' | 'verification' | 'approval' | 'failure' | 'completion';

export interface MissionLifecycleEvent {
  readonly kind: MissionLifecycleKind;
  readonly missionId: string;
  readonly threadId: string;
  readonly rootRunId?: string;
  readonly employeeId?: string;
  readonly at: number;
}

export interface MissionBeatProjection {
  readonly beat: SceneBeat;
  readonly semanticLabel: string;
  readonly phase: MissionBeatPhase;
}
