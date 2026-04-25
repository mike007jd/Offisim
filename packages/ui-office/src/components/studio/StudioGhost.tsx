/**
 * StudioGhost -- Ghost preview with placement validation feedback.
 *
 * Shows a semi-transparent prefab following the mouse during placement.
 * Ground indicator turns red whenever placement is blocked.
 *
 * Validity is multi-reason (`overlap` / `outside-zone` / `category-not-allowed`); the size label
 * surfaces the priority reason text when blocked, falling back to `{w}x{d}` when valid.
 *
 * In zone-edit mode the ghost group additionally clamps its visual position to the focused zone's
 * AABB so it never escapes — the underlying `outside-zone` reason still fires so click placement
 * no-ops at the edge.
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
import type { SemanticCategory, Zone } from '@offisim/shared-types';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  clampFootprintToRect,
  footprintInsideRect,
  footprintsOverlap,
  resolveWorldFootprint,
  zoneToFootprintRect,
} from '../../lib/prefab-spatial.js';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { useStudioStore } from './StudioState.js';
import { STUDIO_COLORS } from './studio-tokens.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

const SNAP = 0.5;

export type PlacementInvalidReason = 'outside-zone' | 'category-not-allowed' | 'overlap';

// Display priority — first match drives the size-label text.
const REASON_PRIORITY: readonly PlacementInvalidReason[] = [
  'outside-zone',
  'category-not-allowed',
  'overlap',
];

interface ValidationResult {
  blocked: boolean;
  reasons: PlacementInvalidReason[];
}

function priorityReason(reasons: PlacementInvalidReason[]): PlacementInvalidReason | null {
  for (const r of REASON_PRIORITY) {
    if (reasons.includes(r)) return r;
  }
  return null;
}

function reasonText(reason: PlacementInvalidReason, zoneLabel: string): string {
  switch (reason) {
    case 'outside-zone':
      return `Outside ${zoneLabel}`;
    case 'category-not-allowed':
      return `Not allowed in ${zoneLabel}`;
    case 'overlap':
      return 'Overlapping';
  }
}

/**
 * Compute placement validity at unclamped (x, z). `outside-zone` and `category-not-allowed` only
 * apply in zone-edit mode against the focused zone; `overlap` always applies.
 */
function validatePlacement(
  x: number,
  z: number,
  ghostPrefabId: string,
  ghostCategory: SemanticCategory | undefined,
  ghostGridSize: readonly [number, number],
  ghostRotation: 0 | 90 | 180 | 270,
  instances: { position: [number, number, number]; rotation: number; prefabId: string }[],
  isEditingZone: boolean,
  focusedZone: Zone | null,
): ValidationResult {
  const reasons: PlacementInvalidReason[] = [];
  const ghostFp = resolveWorldFootprint(ghostPrefabId, ghostGridSize, [x, z], ghostRotation);

  for (const inst of instances) {
    const def = getBuiltinPrefab(inst.prefabId);
    if (!def) continue;
    const instFp = resolveWorldFootprint(
      inst.prefabId,
      def.gridSize,
      [inst.position[0], inst.position[2]],
      inst.rotation as 0 | 90 | 180 | 270,
    );
    if (footprintsOverlap(ghostFp, instFp)) {
      reasons.push('overlap');
      break;
    }
  }

  if (isEditingZone && focusedZone) {
    if (!footprintInsideRect(ghostFp, zoneToFootprintRect(focusedZone))) {
      reasons.push('outside-zone');
    }
    if (
      ghostCategory &&
      focusedZone.allowedCategories.length > 0 &&
      !focusedZone.allowedCategories.includes(ghostCategory)
    ) {
      reasons.push('category-not-allowed');
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

export function StudioGhost() {
  const groupRef = useRef<THREE.Group | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);
  const filledPlaneMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const wireMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const labelDivRef = useRef<HTMLDivElement | null>(null);
  const blockedRef = useRef(false);
  const prevBlockedRef = useRef(false);
  const blockedReasonRef = useRef<PlacementInvalidReason | null>(null);
  const prevReasonRef = useRef<PlacementInvalidReason | null>(null);
  const focusedZoneLabelRef = useRef('');
  const { invalidate } = useThree();

  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const ghostRotation = useStudioStore((s) => s.ghostRotation);
  const plotSize = useStudioStore((s) => s.plotSize);
  const placeInstance = useStudioStore((s) => s.placeInstance);
  const cancelPlacement = useStudioStore((s) => s.cancelPlacement);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  // Read instances/zones/edit-flags via getState() in event handlers to dodge stale closure (PERF-4).

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
    prevBlockedRef.current = false;
    blockedRef.current = false;
    prevReasonRef.current = null;
    blockedReasonRef.current = null;

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

  // ── Memoized footprint edge geometry (Skill §7: no inline THREE objects) ──
  // Must be before any conditional return to satisfy React hooks rules.
  const gridW = placingPrefab?.gridSize[0] ?? 1;
  const gridD = placingPrefab?.gridSize[1] ?? 1;
  const ghostSpec = useMemo(
    () =>
      placingPrefab
        ? resolveWorldFootprint(placingPrefab.prefabId, placingPrefab.gridSize, [0, 0], 0)
        : null,
    [placingPrefab],
  );
  const fpVisualW = ghostSpec ? ghostSpec.halfW * 2 : gridW * 2.5;
  const fpVisualD = ghostSpec ? ghostSpec.halfD * 2 : gridD * 2.5;
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

  // ── Material + label swap useFrame: material on blocked-flip, label on reason-flip. ────
  useFrame(() => {
    if (!placingPrefab || !groupRef.current) return;
    const isBlocked = blockedRef.current;
    const reason = blockedReasonRef.current;
    const blockedChanged = isBlocked !== prevBlockedRef.current;
    const reasonChanged = reason !== prevReasonRef.current;
    if (!blockedChanged && !reasonChanged) return;

    if (blockedChanged) {
      const mat = isBlocked ? blockedMat : validMat;
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = mat;
      });

      if (ringRef.current) {
        const ringMat = ringRef.current.material as THREE.MeshBasicMaterial;
        ringMat.color.set(isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid);
      }
      if (filledPlaneMatRef.current) {
        filledPlaneMatRef.current.color.set(
          isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid,
        );
      }
      if (wireMatRef.current) {
        wireMatRef.current.color.set(
          isBlocked ? STUDIO_COLORS.ghostBlocked : STUDIO_COLORS.ghostValid,
        );
      }
    }

    if (labelDivRef.current && (blockedChanged || reasonChanged)) {
      // Imperative DOM write — avoids React re-render per pointer move.
      // Only `textContent` and `color` are swapped; the border stays at the muted-success tone so
      // we don't fight React's shorthand/longhand reconciliation on a JSX-owned style prop.
      if (isBlocked && reason) {
        labelDivRef.current.textContent = reasonText(reason, focusedZoneLabelRef.current);
        labelDivRef.current.style.color = STUDIO_COLORS.error;
      } else {
        labelDivRef.current.textContent = `${gridW}x${gridD}`;
        labelDivRef.current.style.color = STUDIO_COLORS.success;
      }
    }

    prevBlockedRef.current = isBlocked;
    prevReasonRef.current = reason;
  });

  if (!placingPrefab) return null;

  /**
   * Snap + plot-clamp the raw cursor point and resolve the focused zone.
   * Returns the unclamped (x, z) for validation/placement plus the focused zone (or null).
   */
  function resolvePoint(point: THREE.Vector3) {
    let x = gridSnap ? snap(point.x, SNAP) : point.x;
    let z = gridSnap ? snap(point.z, SNAP) : point.z;
    x = Math.max(-halfW, Math.min(halfW, x));
    z = Math.max(-halfD, Math.min(halfD, z));

    const {
      ghostRotation: curGhostRotation,
      instances: currentInstances,
      placingPrefab: curPlacing,
      isEditingZone,
      focusedZoneId,
      zones,
    } = useStudioStore.getState();
    const focusedZone =
      isEditingZone && focusedZoneId
        ? (zones.find((zone) => zone.zoneId === focusedZoneId) ?? null)
        : null;

    return { x, z, curGhostRotation, currentInstances, curPlacing, isEditingZone, focusedZone };
  }

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
          const {
            x,
            z,
            curGhostRotation,
            currentInstances,
            curPlacing,
            isEditingZone,
            focusedZone,
          } = resolvePoint(e.point);
          focusedZoneLabelRef.current = focusedZone?.label ?? '';

          // Validate against unclamped (x, z) so outside-zone still fires at the edge.
          const result = validatePlacement(
            x,
            z,
            curPlacing?.prefabId ?? '',
            curPlacing?.category,
            curPlacing?.gridSize ?? [1, 1],
            curGhostRotation,
            currentInstances,
            isEditingZone,
            focusedZone,
          );
          blockedRef.current = result.blocked;
          blockedReasonRef.current = priorityReason(result.reasons);

          if (groupRef.current) {
            // Visual clamp: in zone-edit, pin the ghost group to the focused zone AABB so it can
            // never escape. The underlying `outside-zone` reason stays red so click no-ops at the edge.
            if (focusedZone) {
              const ghostFp = resolveWorldFootprint(
                curPlacing?.prefabId ?? '',
                curPlacing?.gridSize ?? [1, 1],
                [x, z],
                curGhostRotation,
              );
              const clamped = clampFootprintToRect(ghostFp, zoneToFootprintRect(focusedZone));
              groupRef.current.position.set(clamped.cx, 0, clamped.cz);
            } else {
              groupRef.current.position.set(x, 0, z);
            }
            groupRef.current.rotation.y = (curGhostRotation * Math.PI) / 180;
            groupRef.current.visible = true;
          }
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const {
            x,
            z,
            curGhostRotation,
            currentInstances,
            curPlacing,
            isEditingZone,
            focusedZone,
          } = resolvePoint(e.point);

          const result = validatePlacement(
            x,
            z,
            curPlacing?.prefabId ?? '',
            curPlacing?.category,
            curPlacing?.gridSize ?? [1, 1],
            curGhostRotation,
            currentInstances,
            isEditingZone,
            focusedZone,
          );
          if (result.blocked) return;

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

        {/* Size / reason label — text + color toggled imperatively in useFrame. */}
        <Html
          position={[0, 0.5, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            ref={labelDivRef}
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
