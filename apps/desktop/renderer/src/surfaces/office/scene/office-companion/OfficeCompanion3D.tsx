import { useUiState } from '@/app/ui-state.js';
import type { SceneCueFrame } from '@/assistant/runtime/scene-cue-projection.js';
import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Sprite } from 'three';
import { NearestFilter } from 'three';
import { OFFICE_DELIVERY_WORLD } from '../office-visual-language.js';
import type { OfficePathfinder } from '../scene-pathfinding.js';
import { useCodexPet } from './CodexPetProvider.js';
import { CODEX_PET_ATLAS, codexPetAtlasFrame } from './codex-pet-animation.js';
import {
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

export function OfficeCompanion3D({ ...props }: OfficeCompanion3DProps) {
  const { atlasUrl } = useCodexPet();
  if (!atlasUrl) return null;
  return <LoadedOfficeCompanion3D key={atlasUrl} {...props} atlasUrl={atlasUrl} />;
}

function LoadedOfficeCompanion3D({
  frame,
  candidates,
  occupiedPoints,
  actorPositions,
  pathfinder,
  geometryRevision,
  reducedMotion,
  atlasUrl,
}: OfficeCompanion3DProps & { readonly atlasUrl: string }) {
  const enabled = useUiState((state) => state.officeCompanionEnabled);
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const mode = useUiState((state) => state.officeMode);
  const sourceTexture = useTexture(atlasUrl);
  const texture = useMemo(() => {
    const clone = sourceTexture.clone();
    clone.repeat.set(1 / CODEX_PET_ATLAS.columns, 1 / CODEX_PET_ATLAS.rows);
    clone.magFilter = NearestFilter;
    clone.minFilter = NearestFilter;
    clone.needsUpdate = true;
    return clone;
  }, [sourceTexture]);
  const spriteRef = useRef<Sprite>(null);
  const planRef = useRef<OfficeCompanionPlan | null>(null);
  const frameKeyRef = useRef<string | null>(null);
  const animationRef = useRef<{ state: string | null; startedAt: number }>({
    state: null,
    startedAt: 0,
  });
  const spatialRevision = useMemo(
    () => officeCompanionSpatialRevision(candidates, occupiedPoints, actorPositions),
    [actorPositions, candidates, occupiedPoints],
  );

  useEffect(
    () => () => {
      texture.dispose();
      sourceTexture.dispose();
      useTexture.clear(atlasUrl);
    },
    [atlasUrl, sourceTexture, texture],
  );

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
    sprite.scale.set(2.06 * (CODEX_PET_ATLAS.cellWidth / CODEX_PET_ATLAS.cellHeight), 2.06, 1);
    let atlasFrame = codexPetAtlasFrame(
      presentation,
      nowMs,
      animationRef.current.startedAt,
      reducedMotion,
    );
    if (animationRef.current.state !== atlasFrame.state) {
      animationRef.current = { state: atlasFrame.state, startedAt: nowMs };
      atlasFrame = codexPetAtlasFrame(presentation, nowMs, nowMs, reducedMotion);
    }
    const frameKey = `${atlasFrame.row}:${atlasFrame.column}`;
    if (frameKeyRef.current !== frameKey) {
      frameKeyRef.current = frameKey;
      texture.offset.set(
        atlasFrame.column / CODEX_PET_ATLAS.columns,
        (CODEX_PET_ATLAS.rows - atlasFrame.row - 1) / CODEX_PET_ATLAS.rows,
      );
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
