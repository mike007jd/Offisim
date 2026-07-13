import { useUiState } from '@/app/ui-state.js';
import companionAtlasUrl from '@/assets/companion/codex-companion-state-sheet.png';
import type { SceneCueFrame } from '@/assistant/runtime/scene-cue-projection.js';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Sprite } from 'three';
import { LinearFilter } from 'three';
import { OFFICE_DELIVERY_WORLD } from '../office-visual-language.js';
import type { OfficePathfinder } from '../scene-pathfinding.js';
import {
  OFFICE_COMPANION_ATLAS_FRAME,
  type OfficeCompanionPlan,
  type OfficeCompanionPoint,
  createOfficeCompanionPlan,
  officeCompanionPlanKey,
  officeCompanionSpatialRevision,
  sampleOfficeCompanionPlan,
} from './companion-projection.js';

export interface OfficeCompanion3DProps {
  readonly frame: SceneCueFrame;
  readonly candidates: readonly OfficeCompanionPoint[];
  readonly occupiedPoints: readonly OfficeCompanionPoint[];
  readonly actorPositions: ReadonlyMap<string, OfficeCompanionPoint>;
  readonly pathfinder: OfficePathfinder | null;
  readonly geometryRevision: string;
  readonly reducedMotion: boolean;
}

export function OfficeCompanion3D({
  frame,
  candidates,
  occupiedPoints,
  actorPositions,
  pathfinder,
  geometryRevision,
  reducedMotion,
}: OfficeCompanion3DProps) {
  const enabled = useUiState((state) => state.officeCompanionEnabled);
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const mode = useUiState((state) => state.officeMode);
  const sourceTexture = useTexture(companionAtlasUrl);
  const texture = useMemo(() => {
    const clone = sourceTexture.clone();
    clone.repeat.set(0.25, 0.5);
    clone.magFilter = LinearFilter;
    clone.needsUpdate = true;
    return clone;
  }, [sourceTexture]);
  const spriteRef = useRef<Sprite>(null);
  const planRef = useRef<OfficeCompanionPlan | null>(null);
  const stateRef = useRef<string | null>(null);
  const spatialRevision = useMemo(
    () => officeCompanionSpatialRevision(candidates, occupiedPoints, actorPositions),
    [actorPositions, candidates, occupiedPoints],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const nowMs = Date.now();
    const input = {
      enabled,
      companyId,
      projectId,
      nowMs,
      mode,
      reducedMotion,
      geometryRevision,
      frame,
      candidates,
      occupiedPoints,
      actorPositions,
      spatialRevision,
      deliveryPoint: OFFICE_DELIVERY_WORLD,
      pathfinder,
    } as const;
    const key = officeCompanionPlanKey(input);
    if (planRef.current?.key !== key) planRef.current = createOfficeCompanionPlan(input);
    const presentation = sampleOfficeCompanionPlan(planRef.current, nowMs);
    sprite.visible = presentation.visible;
    if (!presentation.visible) return;

    const bob = presentation.static ? 0 : Math.sin(nowMs / 190) * 0.045;
    sprite.position.set(presentation.x, 0.04 + bob, presentation.z);
    sprite.scale.set(1.55 * presentation.facing, 2.06, 1);
    if (stateRef.current !== presentation.state) {
      stateRef.current = presentation.state;
      const atlasFrame = OFFICE_COMPANION_ATLAS_FRAME[presentation.state];
      texture.offset.set(atlasFrame.column * 0.25, atlasFrame.row === 0 ? 0.5 : 0);
      texture.needsUpdate = true;
    }
  });

  return (
    <sprite
      ref={spriteRef}
      name="Codex office companion"
      center={[0.5, 0]}
      raycast={() => null}
      renderOrder={2}
    >
      <spriteMaterial
        map={texture}
        transparent
        alphaTest={0.02}
        depthTest
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}
