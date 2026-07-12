import { memo, useRef } from 'react';
import type { Group } from 'three';
import type { ZoneDef } from '../scene-layout.js';
import { LIGHT_SCENE_3D } from './scene-colors.js';
import { EmissiveMaterial, SceneMaterial } from './scene-materials.js';
import { RoundedSlab } from './RoundedSlab.js';
import { SceneAnnotation } from './SceneAnnotation.js';

const ZONE_TINT: Record<string, string> = {
  workspace: LIGHT_SCENE_3D.zoneWorkspace,
  meeting: LIGHT_SCENE_3D.zoneMeeting,
  rest: LIGHT_SCENE_3D.zoneRest,
  lounge: LIGHT_SCENE_3D.zoneRest,
  library: LIGHT_SCENE_3D.zoneLibrary,
  server: LIGHT_SCENE_3D.zoneServer,
};

function zoneTint(archetype: string): string {
  return ZONE_TINT[archetype] ?? LIGHT_SCENE_3D.zoneWorkspace;
}

/** Studio editor preview fixture. The production Office diorama intentionally
 * does not mount this ceiling-dependent component after P6 removes the room. */
export const ZoneCeilingLight = memo(function ZoneCeilingLight({ zone }: { zone: ZoneDef }) {
  const length = Math.min(zone.w * 0.55, 7.2);
  return (
    <group position={[zone.cx, 0, zone.cz]}>
      {[-1, 1].map((side) => (
        <mesh key={`pendant-rod-${side}`} position={[side * length * 0.36, 4.34, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 1.32, 6]} />
          <SceneMaterial materialClass="metal" color={LIGHT_SCENE_3D.wallTrim} />
        </mesh>
      ))}
      <mesh position={[0, 3.7, 0]}>
        <boxGeometry args={[length, 0.055, 0.24]} />
        <SceneMaterial materialClass="metal" color={LIGHT_SCENE_3D.furnitureLight} />
      </mesh>
      <mesh position={[0, 3.665, 0]}>
        <boxGeometry args={[length * 0.94, 0.045, 0.16]} />
        <EmissiveMaterial color={LIGHT_SCENE_3D.whiteboardSurface} tier="signage" intensity={0.8} />
      </mesh>
    </group>
  );
});

/** Thick, soft-edged zone rug and label. Furniture clusters and low dressing
 *  now define the open diorama; no glass wall survives the P6 room removal. */
export const ZoneRug = memo(function ZoneRug({
  zone,
  highlight = false,
  dimmed = false,
  showLabel = true,
}: { zone: ZoneDef; highlight?: boolean; dimmed?: boolean; showLabel?: boolean }) {
  const rugRef = useRef<Group>(null);
  const rugOpacity = dimmed ? 0.22 : 1;
  const labelZ =
    zone.archetype === 'meeting' || zone.archetype === 'server'
      ? -zone.d / 2 + 0.68
      : zone.d / 2 - 0.68;
  const labelX =
    zone.archetype === 'meeting' || zone.archetype === 'library'
      ? -zone.w / 2 + 4.2
      : -zone.w / 2 + 0.72;
  return (
    <group ref={rugRef} position={[zone.cx, 0, zone.cz]}>
      <RoundedSlab
        width={zone.w}
        depth={zone.d}
        height={0.018}
        position={[0, 0.009, 0]}
        cornerRadius={0.3}
        bevelSize={0.005}
      >
        <SceneMaterial
          materialClass="rubber"
          color={highlight ? LIGHT_SCENE_3D.selectionRing : LIGHT_SCENE_3D.floorBorder}
          overrides={{ transparent: dimmed, opacity: dimmed ? 0.18 : 1, roughness: 0.84 }}
        />
      </RoundedSlab>
      <RoundedSlab
        width={Math.max(0.2, zone.w - 0.16)}
        depth={Math.max(0.2, zone.d - 0.16)}
        height={0.04}
        position={[0, 0.02, 0]}
        cornerRadius={0.24}
        bevelSize={0.012}
        receiveShadow
      >
        <SceneMaterial
          materialClass={zone.archetype === 'server' ? 'rubber' : 'carpet'}
          color={highlight ? LIGHT_SCENE_3D.selectionRing : zoneTint(zone.archetype)}
          overrides={{
            roughness: zone.archetype === 'server' ? 0.88 : 0.96,
            transparent: dimmed,
            opacity: rugOpacity,
          }}
        />
      </RoundedSlab>
      {showLabel ? (
        <SceneAnnotation
          position={[labelX, 0.14, labelZ]}
          align="start"
          priority="ambient"
          exclude={rugRef}
        >
          <span className="off-scene-zone-label">{zone.label}</span>
        </SceneAnnotation>
      ) : null}
    </group>
  );
});
