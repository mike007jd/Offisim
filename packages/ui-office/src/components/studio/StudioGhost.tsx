/**
 * StudioGhost -- Ghost preview with placement validation feedback.
 *
 * Shows a semi-transparent prefab following the mouse during placement.
 * Green ground indicator = valid placement.
 * Red ground indicator = overlapping with existing prefab (blocked).
 *
 * Collision detection uses AABB overlap on grid-snapped positions.
 *
 * Material strategy (Skill §11):
 *   Two pre-built MeshStandardMaterial instances (valid/blocked).
 *   On mount: traverse ghost children and replace every mesh material with validMat.
 *   In useFrame: swap material refs ONLY when blocked state changes (no per-frame traversal).
 *
 * Layers (Skill §12):
 *   Ghost group and invisible floor are on Layer 1 (not pickable).
 */

import { getBuiltinPrefab } from '@offisim/renderer';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { footprintsOverlap, getSpatialSpec, toWorldFootprint } from '../../lib/prefab-spatial.js';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { useStudioStore } from './StudioState.js';
import { STUDIO_COLORS } from './studio-tokens.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

const SNAP = 0.5;

/**
 * Return [width, depth] after applying rotation (swap dimensions for 90/270).
 */
function getRotatedSize(w: number, d: number, rotation: number): [number, number] {
  return rotation % 180 === 0 ? [w, d] : [d, w];
}

/**
 * Check if a new prefab at [x, z] with given grid size and rotation overlaps any existing instance.
 * Uses prefab footprint (with padding) when available, falls back to gridSize-based AABB.
 */
function checkOverlap(
  x: number,
  z: number,
  ghostPrefabId: string,
  gridW: number,
  gridD: number,
  ghostRotation: number,
  instances: { position: [number, number, number]; rotation: number; prefabId: string }[],
): boolean {
  const ghostSpec = getSpatialSpec(ghostPrefabId);
  const ghostFp = ghostSpec
    ? toWorldFootprint(ghostSpec.footprint, [x, z], ghostRotation as 0 | 90 | 180 | 270)
    : {
        cx: x,
        cz: z,
        halfW: getRotatedSize(gridW, gridD, ghostRotation)[0] * 0.9,
        halfD: getRotatedSize(gridW, gridD, ghostRotation)[1] * 0.9,
      };

  for (const inst of instances) {
    const instSpec = getSpatialSpec(inst.prefabId);
    const def = getBuiltinPrefab(inst.prefabId);
    if (!def && !instSpec) continue;

    const instFp = instSpec
      ? toWorldFootprint(
          instSpec.footprint,
          [inst.position[0], inst.position[2]],
          inst.rotation as 0 | 90 | 180 | 270,
        )
      : {
          cx: inst.position[0],
          cz: inst.position[2],
          halfW: getRotatedSize(def!.gridSize[0], def!.gridSize[1], inst.rotation)[0] * 0.9,
          halfD: getRotatedSize(def!.gridSize[0], def!.gridSize[1], inst.rotation)[1] * 0.9,
        };

    if (footprintsOverlap(ghostFp, instFp)) {
      return true;
    }
  }
  return false;
}

export function StudioGhost() {
  const groupRef = useRef<THREE.Group | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);
  const filledPlaneMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const blockedRef = useRef(false);
  const prevBlockedRef = useRef(false);
  const { invalidate } = useThree();

  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const ghostRotation = useStudioStore((s) => s.ghostRotation);
  const plotSize = useStudioStore((s) => s.plotSize);
  const placeInstance = useStudioStore((s) => s.placeInstance);
  const cancelPlacement = useStudioStore((s) => s.cancelPlacement);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  // instances is read via getState() in event handlers to avoid stale closure (PERF-4)

  const halfW = plotSize.width / 2;
  const halfD = plotSize.depth / 2;

  // ── Ghost materials (Skill §11) ──────────────────────────────────
  const validMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: STUDIO_COLORS.ghostValid,
        emissive: STUDIO_COLORS.ghostValid,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const blockedMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: STUDIO_COLORS.ghostBlocked,
        emissive: STUDIO_COLORS.ghostBlocked,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Dispose ghost materials on unmount
  useEffect(() => {
    return () => {
      validMat.dispose();
      blockedMat.dispose();
    };
  }, [validMat, blockedMat]);

  // On placingPrefab change: traverse ghost children and assign validMat
  useEffect(() => {
    if (!placingPrefab || !groupRef.current) return;
    // Reset blocked tracking so the useFrame swap fires on first real check
    prevBlockedRef.current = false;
    blockedRef.current = false;

    // Small delay to let Prefab3D mount its meshes
    const raf = requestAnimationFrame(() => {
      if (!groupRef.current) return;
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = validMat;
        }
      });
      invalidate();
    });
    return () => cancelAnimationFrame(raf);
  }, [placingPrefab, validMat, invalidate]);

  // ── Layer assignment (Skill §12): ghost group → Layer 1 ──────────
  useEffect(() => {
    if (groupRef.current) groupRef.current.layers.set(1);
  }, []);

  // NOTE: invisible floor stays on Layer 0 — it MUST receive R3F pointer events.
  // Only the ghost visual group is on Layer 1 (not pickable for selection).

  // ── Apply ghost rotation when R key is pressed (without pointer move) ──
  useEffect(() => {
    if (groupRef.current && placingPrefab) {
      groupRef.current.rotation.y = (ghostRotation * Math.PI) / 180;
      invalidate();
    }
  }, [ghostRotation, placingPrefab, invalidate]);

  // Ring geometry for ground indicator (disposed on unmount)
  const ringGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.6, 0.8, 32);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);
  useEffect(
    () => () => {
      ringGeo.dispose();
    },
    [ringGeo],
  );

  // ── Ring pulse animation ─────────────────────────────────────────
  // NOTE: No invalidate() call here — onPointerMove already invalidates.
  // Calling invalidate() in useFrame creates an infinite render loop in
  // frameloop="demand" mode (Skill §7).
  useFrame(({ clock }) => {
    if (!ringRef.current || !placingPrefab) return;
    const t = clock.getElapsedTime();
    const mat = ringRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.5 + Math.sin(t * 4) * 0.15;
  });

  // ── Material swap useFrame (only on blocked state change) ────────
  useFrame(() => {
    if (!placingPrefab || !groupRef.current) return;
    const isBlocked = blockedRef.current;
    if (isBlocked === prevBlockedRef.current) return; // no change, skip
    prevBlockedRef.current = isBlocked;

    // Swap ghost mesh materials
    const mat = isBlocked ? blockedMat : validMat;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material = mat;
    });

    // Swap ring color
    if (ringRef.current) {
      const ringMat = ringRef.current.material as THREE.MeshBasicMaterial;
      ringMat.color.set(isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid);
    }

    // Swap footprint filled plane color
    if (filledPlaneMatRef.current) {
      filledPlaneMatRef.current.color.set(
        isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid,
      );
    }

    // Swap footprint wireframe border color
    if (wireMatRef.current) {
      wireMatRef.current.color.set(
        isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid,
      );
    }
  });

  // ── Memoized footprint edge geometry (Skill §7: no inline THREE objects) ──
  // Must be before any conditional return to satisfy React hooks rules.
  const gridW = placingPrefab?.gridSize[0] ?? 1;
  const gridD = placingPrefab?.gridSize[1] ?? 1;
  const ghostSpec = getSpatialSpec(placingPrefab?.prefabId ?? '');
  const fpVisualW = ghostSpec
    ? (ghostSpec.footprint.halfW + ghostSpec.footprint.padding) * 2
    : gridW * 2.5;
  const fpVisualD = ghostSpec
    ? (ghostSpec.footprint.halfD + ghostSpec.footprint.padding) * 2
    : gridD * 2.5;
  const footprintEdgeGeo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.PlaneGeometry(fpVisualW, fpVisualD)),
    [fpVisualW, fpVisualD],
  );
  useEffect(
    () => () => {
      footprintEdgeGeo.dispose();
    },
    [footprintEdgeGeo],
  );

  if (!placingPrefab) return null;

  return (
    <>
      {/* Invisible floor for raycast — stays on Layer 0 so R3F events work */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: R3F floor mesh is a pointer-only placement surface, not a keyboard-focusable DOM control. */}
      <mesh
        ref={floorRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));

          // Check collision (rotation-aware) — read from getState() to avoid stale closure (PERF-4)
          const {
            ghostRotation: curGhostRotation,
            instances: currentInstances,
            placingPrefab: curPlacing,
          } = useStudioStore.getState();
          const isBlocked = checkOverlap(
            x,
            z,
            curPlacing?.prefabId ?? '',
            gridW,
            gridD,
            curGhostRotation,
            currentInstances,
          );
          blockedRef.current = isBlocked;

          if (groupRef.current) {
            groupRef.current.position.set(x, 0, z);
            groupRef.current.rotation.y = (curGhostRotation * Math.PI) / 180;
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

          // Block placement if overlapping (rotation-aware) — read from getState() (PERF-4)
          const {
            ghostRotation: curGhostRotation,
            instances: currentInstances,
            placingPrefab: curPlacing,
          } = useStudioStore.getState();
          if (
            checkOverlap(
              x,
              z,
              curPlacing?.prefabId ?? '',
              gridW,
              gridD,
              curGhostRotation,
              currentInstances,
            )
          ) {
            return; // don't place
          }

          placeInstance([x, 0, z]);
          invalidate();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          cancelPlacement();
          invalidate();
        }}
      >
        <planeGeometry args={[plotSize.width * 2, plotSize.depth * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Ghost mesh group — Layer 1 (not pickable) */}
      <group ref={groupRef} visible={false} layers={1}>
        {/* The prefab preview */}
        <Prefab3D definition={placingPrefab} />

        {/* Ground placement indicator ring */}
        <mesh ref={ringRef} geometry={ringGeo} position={[0, 0.02, 0]}>
          <meshBasicMaterial
            color={STUDIO_COLORS.ghostValid}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Grid footprint — filled area (y=0.02, above ground, below mesh) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[fpVisualW, fpVisualD]} />
          <meshBasicMaterial
            ref={filledPlaneMatRef}
            color={STUDIO_COLORS.ghostValid}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Grid footprint — wireframe border (rotated to XZ plane) */}
        <lineSegments rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <primitive object={footprintEdgeGeo} attach="geometry" />
          <lineBasicMaterial
            ref={wireMatRef}
            color={STUDIO_COLORS.ghostValid}
            transparent
            opacity={0.8}
          />
        </lineSegments>

        {/* Size label (e.g., "2x2") */}
        <Html
          position={[0, 0.5, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(0,0,0,0.7)',
              color: STUDIO_COLORS.success,
              padding: '2px 6px',
              borderRadius: 3,
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              border: `1px solid ${STUDIO_COLORS.successMuted}`,
            }}
          >
            {gridW}x{gridD}
          </div>
        </Html>
      </group>
    </>
  );
}
