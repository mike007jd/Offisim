import { Html } from '@react-three/drei';
import { memo } from 'react';
import type { ZoneDef } from '../scene-layout.js';
import { LIGHT_SCENE_3D } from './scene-colors.js';
import { EmissiveMaterial, SceneMaterial } from './scene-materials.js';

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

/** Suspended linear luminaire over each zone — gives the room a ceiling line
 *  and per-zone identity without any actual light cost (emissive only).
 *  Memoized: `zone` is referentially stable, and drag pointermoves re-render
 *  the whole Canvas tree per event. */
export const ZoneCeilingLight = memo(function ZoneCeilingLight({ zone }: { zone: ZoneDef }) {
  const length = Math.min(zone.w * 0.55, 7.2);
  // No castShadow anywhere here: a shadow-casting bar at y≈3.7 would paint a
  // hard dark stripe across the zone floor.
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
      {/* Glow tube proud of the housing on all faces, so the fixture reads lit
          from above, the side, and below. */}
      <mesh position={[0, 3.665, 0]}>
        <boxGeometry args={[length * 0.94, 0.045, 0.16]} />
        <EmissiveMaterial color={LIGHT_SCENE_3D.whiteboardSurface} tier="signage" intensity={0.8} />
      </mesh>
    </group>
  );
});

/** Zone floor rug, border strips, and label. Memoized like ZoneCeilingLight —
 *  only the zone being hovered/highlighted re-renders during drags. */
export const ZoneRug = memo(function ZoneRug({
  zone,
  highlight = false,
  dimmed = false,
}: { zone: ZoneDef; highlight?: boolean; dimmed?: boolean }) {
  const borderOpacity = dimmed ? 0.12 : highlight ? 0.86 : 0.42;
  const rugOpacity = dimmed ? 0.14 : highlight ? 0.48 : zone.archetype === 'server' ? 0.62 : 0.56;
  const showGlass =
    !dimmed &&
    (zone.archetype === 'meeting' || zone.archetype === 'server' || zone.archetype === 'library');
  const labelZ =
    zone.archetype === 'meeting' || zone.archetype === 'server'
      ? -zone.d / 2 + 0.68
      : zone.d / 2 - 0.68;
  const labelX =
    zone.archetype === 'meeting' || zone.archetype === 'library'
      ? -zone.w / 2 + 4.2
      : -zone.w / 2 + 0.72;
  const borderStrips: [number, number, number, number][] = [
    [0, -zone.d / 2, zone.w, 0.07],
    [0, zone.d / 2, zone.w, 0.07],
    [-zone.w / 2, 0, 0.07, zone.d],
    [zone.w / 2, 0, 0.07, zone.d],
  ];
  return (
    <group position={[zone.cx, 0, zone.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[zone.w, zone.d]} />
        <SceneMaterial
          materialClass={zone.archetype === 'server' ? 'rubber' : 'carpet'}
          color={highlight ? LIGHT_SCENE_3D.selectionRing : zoneTint(zone.archetype)}
          overrides={{
            roughness: zone.archetype === 'server' ? 0.86 : 0.95,
            transparent: true,
            opacity: rugOpacity,
          }}
        />
      </mesh>
      {borderStrips.map(([x, z, w, d]) => (
        <mesh key={`zone-border-${x}-${z}`} position={[x, 0.044, z]} receiveShadow>
          <boxGeometry args={[w, 0.032, d]} />
          <SceneMaterial
            materialClass="rubber"
            color={highlight ? LIGHT_SCENE_3D.selectionRing : LIGHT_SCENE_3D.floorBorder}
            overrides={{ transparent: true, opacity: borderOpacity, roughness: 0.82 }}
          />
        </mesh>
      ))}
      {showGlass ? (
        <mesh position={[0, 0.62, -zone.d / 2 + 0.1]} castShadow receiveShadow>
          <boxGeometry args={[zone.w * 0.82, 1.18, 0.045]} />
          <SceneMaterial
            materialClass="glass"
            color={LIGHT_SCENE_3D.partition}
            overrides={{ transparent: true, opacity: 0.2, roughness: 0.16, thickness: 0.05 }}
          />
        </mesh>
      ) : null}
      {highlight ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry
            args={[Math.min(zone.w, zone.d) / 2 - 0.3, Math.min(zone.w, zone.d) / 2, 48]}
          />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.7} />
        </mesh>
      ) : null}
      <Html
        position={[labelX, 0.1, labelZ]}
        center={false}
        distanceFactor={12}
        occlude={false}
        zIndexRange={[2, 0]}
        className="off-scene-html-passive"
      >
        <span className="off-scene-zone-label">{zone.label}</span>
      </Html>
    </group>
  );
});
