import { findOverlaps } from '@offisim/shared-types';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { toOverlapRects, useStudioStore } from './StudioState.js';
import { FONT } from './studio-tokens.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

const SNAP = 0.5;

const VALID_FILL = 'rgba(34, 197, 94, 0.15)';
const VALID_BORDER = 'rgb(34, 197, 94)';
const BLOCKED_FILL = 'rgba(239, 68, 68, 0.15)';
const BLOCKED_BORDER = 'rgb(239, 68, 68)';

const BORDER_THICKNESS = 0.06;
const BORDER_HEIGHT = 0.04;

export function StudioZoneGhost() {
  const groupRef = useRef<THREE.Group | null>(null);
  const fillMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const borderMatRefs = useRef<THREE.MeshBasicMaterial[]>([]);
  const blockedRef = useRef(false);
  const { invalidate } = useThree();

  const placingZonePreset = useStudioStore((s) => s.placingZonePreset);
  const ghostRotation = useStudioStore((s) => s.ghostRotation);
  const plotSize = useStudioStore((s) => s.plotSize);
  const gridSnap = useStudioStore((s) => s.gridSnap);

  const halfW = plotSize.width / 2;
  const halfD = plotSize.depth / 2;

  if (!placingZonePreset) return null;

  const preset = placingZonePreset;
  const isRotated = ghostRotation === 90 || ghostRotation === 270;
  const ghostW = isRotated ? preset.d : preset.w;
  const ghostD = isRotated ? preset.w : preset.d;

  function checkZoneOverlap(x: number, z: number): boolean {
    const { zones } = useStudioStore.getState();
    const candidate = { id: '__ghost__', cx: x, cz: z, w: ghostW, d: ghostD };
    return findOverlaps(candidate, toOverlapRects(zones)).length > 0;
  }

  function applyColors(blocked: boolean) {
    const fill = blocked ? BLOCKED_FILL : VALID_FILL;
    const border = blocked ? BLOCKED_BORDER : VALID_BORDER;

    if (fillMatRef.current) {
      fillMatRef.current.color.set(blocked ? '#ef4444' : '#22c55e');
      fillMatRef.current.opacity = 0.15;
    }
    for (const mat of borderMatRefs.current) {
      mat.color.set(border);
    }
    void fill;
  }

  return (
    <>
      {/* Invisible floor for raycast — Layer 0 */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: R3F floor mesh is a pointer-only placement surface, not a keyboard-focusable DOM control. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));

          const isBlocked = checkZoneOverlap(x, z);
          const wasBlocked = blockedRef.current;
          blockedRef.current = isBlocked;

          if (isBlocked !== wasBlocked) {
            applyColors(isBlocked);
          }

          if (groupRef.current) {
            groupRef.current.position.set(x, 0, z);
            groupRef.current.visible = true;
          }
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));

          if (checkZoneOverlap(x, z)) return;

          const store = useStudioStore.getState();
          store.placeZoneFromPreset([x, 0, z], new Map());
          store.cancelZonePlacement();
          invalidate();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          useStudioStore.getState().cancelZonePlacement();
          invalidate();
        }}
      >
        <planeGeometry args={[plotSize.width * 2, plotSize.depth * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Ghost group — Layer 1 (not pickable) */}
      <group ref={groupRef} visible={false} layers={1}>
        {/* Filled rectangle on XZ plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[ghostW, ghostD]} />
          <meshBasicMaterial
            ref={fillMatRef}
            color="#22c55e"
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Border edges — 4 thin box meshes */}
        {/* Top edge (negative Z) */}
        <mesh position={[0, BORDER_HEIGHT / 2, -ghostD / 2]}>
          <boxGeometry args={[ghostW, BORDER_HEIGHT, BORDER_THICKNESS]} />
          <meshBasicMaterial
            ref={(el) => {
              if (el) borderMatRefs.current[0] = el;
            }}
            color={VALID_BORDER}
            transparent
            opacity={0.8}
          />
        </mesh>
        {/* Bottom edge (positive Z) */}
        <mesh position={[0, BORDER_HEIGHT / 2, ghostD / 2]}>
          <boxGeometry args={[ghostW, BORDER_HEIGHT, BORDER_THICKNESS]} />
          <meshBasicMaterial
            ref={(el) => {
              if (el) borderMatRefs.current[1] = el;
            }}
            color={VALID_BORDER}
            transparent
            opacity={0.8}
          />
        </mesh>
        {/* Left edge (negative X) */}
        <mesh position={[-ghostW / 2, BORDER_HEIGHT / 2, 0]}>
          <boxGeometry args={[BORDER_THICKNESS, BORDER_HEIGHT, ghostD]} />
          <meshBasicMaterial
            ref={(el) => {
              if (el) borderMatRefs.current[2] = el;
            }}
            color={VALID_BORDER}
            transparent
            opacity={0.8}
          />
        </mesh>
        {/* Right edge (positive X) */}
        <mesh position={[ghostW / 2, BORDER_HEIGHT / 2, 0]}>
          <boxGeometry args={[BORDER_THICKNESS, BORDER_HEIGHT, ghostD]} />
          <meshBasicMaterial
            ref={(el) => {
              if (el) borderMatRefs.current[3] = el;
            }}
            color={VALID_BORDER}
            transparent
            opacity={0.8}
          />
        </mesh>

        {/* Html label overlay */}
        <Html position={[0, 0.4, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: 'rgba(0,0,0,0.75)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              color: '#fff',
              whiteSpace: 'nowrap',
              fontFamily: FONT.family,
            }}
          >
            {preset.label} &middot; {ghostW}&times;{ghostD} &middot; {preset.prefabs.length} items
          </div>
        </Html>
      </group>
    </>
  );
}
