import type { OfficeCompanionPresentation } from './companion-projection.js';

export const CODEX_PET_ATLAS = {
  width: 1536,
  height: 1872,
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
} as const;

type CodexPetAnimationState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

interface AnimationSpec {
  readonly row: number;
  readonly durations: readonly number[];
}

const ANIMATIONS: Readonly<Record<CodexPetAnimationState, AnimationSpec>> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

export interface CodexPetAtlasFrame {
  readonly state: CodexPetAnimationState;
  readonly row: number;
  readonly column: number;
  readonly nextFrameAt: number | null;
}

function presentationAnimation(
  presentation: Pick<OfficeCompanionPresentation, 'facing' | 'moving' | 'state'>,
): CodexPetAnimationState {
  if (presentation.moving || presentation.state === 'run') {
    return presentation.facing < 0 ? 'running-left' : 'running-right';
  }
  switch (presentation.state) {
    case 'inspect':
      return 'waiting';
    case 'work-watch':
      return 'review';
    case 'celebrate':
      return 'jumping';
    case 'greet':
      return 'waving';
    case 'concerned':
      return 'failed';
    default:
      return 'idle';
  }
}

export function codexPetAtlasFrame(
  presentation: Pick<OfficeCompanionPresentation, 'facing' | 'moving' | 'state'>,
  nowMs: number,
  animationStartedAt: number,
  reducedMotion: boolean,
): CodexPetAtlasFrame {
  if (reducedMotion) {
    return { state: 'idle', row: 0, column: 0, nextFrameAt: null };
  }

  const state = presentationAnimation(presentation);
  const spec = ANIMATIONS[state];
  const cycleDuration = spec.durations.reduce((total, duration) => total + duration, 0);
  const elapsed = Math.max(0, nowMs - animationStartedAt) % cycleDuration;
  let boundary = 0;
  for (let column = 0; column < spec.durations.length; column += 1) {
    boundary += spec.durations[column] ?? 0;
    if (elapsed < boundary) {
      return {
        state,
        row: spec.row,
        column,
        nextFrameAt: nowMs + Math.max(1, boundary - elapsed),
      };
    }
  }
  return { state, row: spec.row, column: 0, nextFrameAt: nowMs + (spec.durations[0] ?? 1) };
}
