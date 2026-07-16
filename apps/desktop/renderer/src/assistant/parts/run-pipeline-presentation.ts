import type {
  ConversationRunPhase,
  ConversationRunSnapshot,
} from '../runtime/conversation-run-controller.js';

type RunPipelineStageState = 'done' | 'active' | 'pending';

export interface RunPipelinePresentation {
  readonly phase: ConversationRunPhase;
  readonly phaseLabel: string;
  readonly title: string;
  readonly completedStages: number;
  readonly totalStages: number;
  readonly progressValue: number;
  readonly terminalLabel: string | null;
  readonly stages: readonly {
    readonly id: 'prepare' | 'work' | 'approval' | 'response';
    readonly label: string;
    readonly state: RunPipelineStageState;
  }[];
}

const STAGE_LABELS = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'work', label: 'Work' },
  { id: 'approval', label: 'Approval' },
  { id: 'response', label: 'Response' },
] as const;

const PHASE_PROGRESS: Record<ConversationRunPhase, number> = {
  idle: 0,
  preparing: 0,
  running: 1,
  'awaiting-approval': 2,
  completed: 4,
  interrupted: 0,
  failed: 0,
};

const PHASE_LABEL: Record<ConversationRunPhase, string> = {
  idle: 'Ready',
  preparing: 'Preparing',
  running: 'Working',
  'awaiting-approval': 'Approval',
  completed: 'Complete',
  interrupted: 'Interrupted',
  failed: 'Failed',
};

const TERMINAL_LABEL: Record<ConversationRunPhase, string | null> = {
  idle: null,
  preparing: 'Stop',
  running: 'Stop',
  'awaiting-approval': 'Stop',
  completed: 'Done',
  interrupted: 'Stopped',
  failed: 'Failed',
};

function runTitle(
  phase: ConversationRunPhase,
  source: ConversationRunSnapshot['source'] | null,
): string {
  if (phase === 'idle') return 'No live run';
  if (phase === 'awaiting-approval') return 'Waiting for approval';
  if (phase === 'completed') return 'Last run completed';
  if (phase === 'interrupted') return 'Last run interrupted';
  if (phase === 'failed') return 'Last run failed';
  return source === 'workspace' ? 'Workspace task' : 'Conversation task';
}

export function runPipelinePresentation(
  phase: ConversationRunPhase,
  source: ConversationRunSnapshot['source'] | null = null,
): RunPipelinePresentation {
  const completedStages = PHASE_PROGRESS[phase];
  const activeStage =
    phase === 'preparing'
      ? 'prepare'
      : phase === 'running'
        ? 'work'
        : phase === 'awaiting-approval'
          ? 'approval'
          : null;
  const stages = STAGE_LABELS.map((stage, index) => ({
    ...stage,
    state:
      stage.id === activeStage
        ? ('active' as const)
        : index < completedStages
          ? ('done' as const)
          : ('pending' as const),
  }));

  return {
    phase,
    phaseLabel: PHASE_LABEL[phase],
    title: runTitle(phase, source),
    completedStages,
    totalStages: STAGE_LABELS.length,
    progressValue: (completedStages / STAGE_LABELS.length) * 100,
    terminalLabel: TERMINAL_LABEL[phase],
    stages,
  };
}
