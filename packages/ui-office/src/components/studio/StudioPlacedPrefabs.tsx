/**
 * StudioPlacedPrefabs — Renders all placed prefab instances in the studio 3D scene.
 *
 * Click to select, TransformControls for move/rotate on the selected instance.
 * Memoized items to prevent TransformControls flicker.
 */

import { getBuiltinPrefab } from '@aics/renderer';
import { resolveZoneForPosition } from '@aics/shared-types';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { type PlacedInstance, useStudioStore } from './StudioState.js';
import { STUDIO_COLORS } from './studio-tokens.js';

// ---------------------------------------------------------------------------
// Highlight ring constants
// ---------------------------------------------------------------------------

const RING_INNER = 0.8;
const RING_OUTER = 1.0;
const RING_SEGMENTS = 32;

// Pre-allocated objects for handleObjectChange (Skill §7: no allocations in hot path)
const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();

// ---------------------------------------------------------------------------
// PlacedPrefabItem — memoized single prefab instance
// ---------------------------------------------------------------------------

interface PlacedPrefabItemProps {
  instance: PlacedInstance;
  isSelected: boolean;
  onSelect: (id: string) => void;
  highlightRingGeo: THREE.RingGeometry;
  highlightRingMat: THREE.MeshBasicMaterial;
}

const PlacedPrefabItem = memo(function PlacedPrefabItem({
  instance,
  isSelected,
  onSelect,
  highlightRingGeo,
  highlightRingMat,
}: PlacedPrefabItemProps) {
  const { gl, invalidate } = useThree();

  const definition = useMemo(() => getBuiltinPrefab(instance.prefabId), [instance.prefabId]);

  const handleClick = useCallback(
    (e: THREE.Event) => {
      // Prevent OrbitControls / canvas pointerMissed from firing
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      // Only allow selection with appropriate tools (Skill §2)
      const tool = useStudioStore.getState().tool;
      if (tool !== 'select' && tool !== 'move' && tool !== 'rotate') return;
      onSelect(instance.id);
    },
    [instance.id, onSelect],
  );

  // Hover feedback — emissive highlight + pointer cursor (Skill §10)
  const handlePointerOver = useCallback(
    (e: THREE.Event) => {
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      const tool = useStudioStore.getState().tool;
      if (tool !== 'select' && tool !== 'move' && tool !== 'rotate') return;
      (e as unknown as { eventObject: THREE.Group }).eventObject.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 0.08;
          child.material.emissive.set('#ffffff');
        }
      });
      gl.domElement.style.cursor = 'pointer';
      invalidate();
    },
    [gl, invalidate],
  );

  const handlePointerOut = useCallback(
    (e: THREE.Event) => {
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      (e as unknown as { eventObject: THREE.Group }).eventObject.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 0;
        }
      });
      gl.domElement.style.cursor = 'default';
      invalidate();
    },
    [gl, invalidate],
  );

  if (!definition) return null;

  return (
    <group
      position={instance.position}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      onPointerDown={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <Prefab3D definition={definition} state="idle" />
      {isSelected && (
        <mesh geometry={highlightRingGeo} material={highlightRingMat} position={[0, 0.02, 0]} />
      )}
      {/* Size label */}
      <Html position={[0, 0.3, 0]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: isSelected ? STUDIO_COLORS.accentText : STUDIO_COLORS.textSecondary,
            padding: '1px 4px',
            borderRadius: 2,
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            border: isSelected
              ? `1px solid ${STUDIO_COLORS.borderActive}`
              : `1px solid ${STUDIO_COLORS.borderSubtle}`,
          }}
        >
          {definition.gridSize[0]}x{definition.gridSize[1]}
        </div>
      </Html>
    </group>
  );
});

// ---------------------------------------------------------------------------
// StudioPlacedPrefabs — orchestrator with TransformControls
// ---------------------------------------------------------------------------

export function StudioPlacedPrefabs() {
  const instances = useStudioStore((s) => s.instances);
  const selectedId = useStudioStore((s) => s.selectedInstanceId);
  const tool = useStudioStore((s) => s.tool);
  const updatePosition = useStudioStore((s) => s.updatePosition);
  const updateRotation = useStudioStore((s) => s.updateRotation);
  const selectInstance = useStudioStore((s) => s.selectInstance);

  const { invalidate } = useThree();

  // Highlight ring geometry + material (disposed on unmount)
  const highlightRingGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);
  const highlightRingMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#6366f1',
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => {
    return () => {
      highlightRingGeo.dispose();
      highlightRingMat.dispose();
    };
  }, [highlightRingGeo, highlightRingMat]);

  // Ref for the group that wraps the selected instance (TransformControls target)
  const selectedGroupRef = useRef<THREE.Group | null>(null);

  // Derive the selected instance data
  const selectedInstance = useMemo(
    () => (selectedId ? instances.find((i) => i.id === selectedId) : undefined),
    [selectedId, instances],
  );

  // TransformControls mode from studio tool
  const transformMode: 'translate' | 'rotate' = tool === 'rotate' ? 'rotate' : 'translate';

  // Whether TransformControls should be active
  const transformEnabled = selectedInstance != null && (tool === 'move' || tool === 'rotate');

  // Stable select callback for memoized items
  const handleSelect = useCallback(
    (id: string) => {
      selectInstance(id);
    },
    [selectInstance],
  );

  // TransformControls change handler — sync group transform back to store
  const handleObjectChange = useCallback(() => {
    const group = selectedGroupRef.current;
    if (!group || !selectedId) return;

    if (transformMode === 'translate') {
      // Read world position from the group (re-use pre-allocated vector)
      group.getWorldPosition(_pos);
      updatePosition(selectedId, [_pos.x, _pos.y, _pos.z]);

      // Re-resolve zone assignment (trigger point 2: drag)
      const inst = useStudioStore.getState().instances.find((i) => i.id === selectedId);
      const def = inst ? getBuiltinPrefab(inst.prefabId) : null;
      if (def) {
        const { zones } = useStudioStore.getState();
        const match = resolveZoneForPosition(_pos.x, _pos.z, def.category, zones);
        if (inst && match.zoneId !== inst.zoneId) {
          useStudioStore.getState().updateZoneId(selectedId, match.zoneId);
        }
      }
    } else {
      // Read Y rotation (euler) and snap to nearest 90-degree increment
      _euler.setFromQuaternion(group.quaternion, 'YXZ');
      const degrees = THREE.MathUtils.radToDeg(_euler.y);
      // Snap to 0/90/180/270
      const snapped = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
      updateRotation(selectedId, snapped as 0 | 90 | 180 | 270);
    }

    invalidate();
  }, [selectedId, transformMode, updatePosition, updateRotation, invalidate]);

  // Non-selected instances — inline filter instead of useMemo.
  // The memo was broken: instances ref changes every drag frame (PERF-3 mitigates this,
  // but inline is simpler and equally fast for <100 items). (PERF-5)
  const nonSelectedInstances = instances.filter((i) => i.id !== selectedId);

  // Selected instance definition
  const selectedDefinition = useMemo(
    () => (selectedInstance ? getBuiltinPrefab(selectedInstance.prefabId) : undefined),
    [selectedInstance],
  );

  return (
    <>
      {/* Non-selected instances */}
      {nonSelectedInstances.map((inst) => (
        <PlacedPrefabItem
          key={inst.id}
          instance={inst}
          isSelected={false}
          onSelect={handleSelect}
          highlightRingGeo={highlightRingGeo}
          highlightRingMat={highlightRingMat}
        />
      ))}

      {/* Selected instance — rendered in its own group for TransformControls attachment */}
      {selectedInstance && selectedDefinition && (
        <group
          ref={selectedGroupRef}
          position={selectedInstance.position}
          rotation={[0, (selectedInstance.rotation * Math.PI) / 180, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            handleSelect(selectedInstance.id);
          }}
        >
          <Prefab3D definition={selectedDefinition} state="idle" />
          <mesh geometry={highlightRingGeo} material={highlightRingMat} position={[0, 0.02, 0]} />
        </group>
      )}

      {/* TransformControls — only mounted when a target exists (drei TC crashes on null object) */}
      {selectedInstance && selectedDefinition && (
        <TransformControls
          object={selectedGroupRef as React.RefObject<THREE.Object3D>}
          enabled={transformEnabled}
          visible={transformEnabled}
          mode={transformMode}
          translationSnap={0.5}
          rotationSnap={Math.PI / 2}
          showX={true}
          showY={transformMode === 'rotate'}
          showZ={true}
          space="world"
          onObjectChange={handleObjectChange}
        />
      )}
    </>
  );
}
