import type { CeremonyPhase } from '../../hooks/useSceneOrchestrator';

export interface SceneRenderPolicyInput {
  activeCount: number;
  blockedCount: number;
  isDragging: boolean;
  flowLineCount: number;
  ceremonyPhase: CeremonyPhase;
}

export function shouldAnimateOfficeScene({
  activeCount,
  blockedCount,
  isDragging,
  flowLineCount,
  ceremonyPhase,
}: SceneRenderPolicyInput): boolean {
  return (
    isDragging ||
    flowLineCount > 0 ||
    activeCount > 0 ||
    blockedCount > 0 ||
    ceremonyPhase !== 'idle'
  );
}
