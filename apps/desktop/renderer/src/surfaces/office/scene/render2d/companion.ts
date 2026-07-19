import { CODEX_PET_ATLAS, codexPetAtlasFrame } from '../office-companion/codex-pet-animation.js';
import {
  type OfficeCompanionPlan,
  createOfficeCompanionPlan,
  officeCompanionPlanKey,
  sampleOfficeCompanionPlan,
} from '../office-companion/companion-projection.js';
import type { Render2DSurface } from './background.js';

type CompanionPlanInput = Parameters<typeof officeCompanionPlanKey>[0];

export interface CompanionAnimationState {
  readonly state: string | null;
  readonly startedAt: number;
}

export interface CompanionRenderResult {
  readonly plan: OfficeCompanionPlan | null;
  readonly animation: CompanionAnimationState;
  readonly animationWakeAt: number | null;
}

export function drawCompanion({
  surface,
  atlas,
  atlasReady,
  input,
  plan,
  animation,
}: {
  surface: Render2DSurface;
  atlas: HTMLImageElement | null;
  atlasReady: boolean;
  input: Omit<CompanionPlanInput, 'nowMs'>;
  plan: OfficeCompanionPlan | null;
  animation: CompanionAnimationState;
}): CompanionRenderResult {
  if (
    !input.enabled ||
    !atlasReady ||
    atlas?.naturalWidth !== CODEX_PET_ATLAS.width ||
    atlas.naturalHeight !== CODEX_PET_ATLAS.height
  ) {
    return {
      plan: null,
      animationWakeAt: null,
      animation: { state: null, startedAt: 0 },
    };
  }

  const nowMs = Date.now();
  const fullInput = { ...input, nowMs } as CompanionPlanInput;
  const key = officeCompanionPlanKey(fullInput);
  let nextPlan = plan;
  if (nextPlan?.key !== key) nextPlan = createOfficeCompanionPlan(fullInput);
  const companion = sampleOfficeCompanionPlan(nextPlan, nowMs);
  if (!companion.visible) {
    return {
      plan: nextPlan,
      animationWakeAt: null,
      animation: { state: null, startedAt: 0 },
    };
  }

  let nextAnimation = animation;
  let atlasFrame = codexPetAtlasFrame(
    companion,
    nowMs,
    nextAnimation.startedAt,
    input.reducedMotion,
  );
  if (nextAnimation.state !== atlasFrame.state) {
    nextAnimation = { state: atlasFrame.state, startedAt: nowMs };
    atlasFrame = codexPetAtlasFrame(companion, nowMs, nowMs, input.reducedMotion);
  }
  const { ctx, scale, wx, wy } = surface;
  const height = Math.min(68, Math.max(34, scale * 1.95));
  const width = height * (CODEX_PET_ATLAS.cellWidth / CODEX_PET_ATLAS.cellHeight);
  const sx = wx(companion.x);
  const sy = wy(companion.z);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(sx, sy);
  ctx.drawImage(
    atlas,
    atlasFrame.column * CODEX_PET_ATLAS.cellWidth,
    atlasFrame.row * CODEX_PET_ATLAS.cellHeight,
    CODEX_PET_ATLAS.cellWidth,
    CODEX_PET_ATLAS.cellHeight,
    -width / 2,
    -height,
    width,
    height,
  );
  ctx.restore();
  return {
    plan: nextPlan,
    animation: nextAnimation,
    animationWakeAt: atlasFrame.nextFrameAt,
  };
}
