/**
 * StudioPlacedPrefabs — Renders all placed prefab instances in the studio 3D scene.
 *
 * Click to select, TransformControls for move/rotate on the selected instance.
 * Memoized items to prevent TransformControls flicker.
 */

import { useRef, useCallback, useMemo, memo } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { getBuiltinPrefab } from '@aics/renderer';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { useStudioStore, type PlacedInstance } from './StudioState.js';

// ---------------------------------------------------------------------------
// Highlight ring geometry (shared across all instances)
// ---------------------------------------------------------------------------

const RING_INNER = 0.8;
const RING_OUTER = 1.0;
const RING_SEGMENTS = 32;

const highlightRingGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, RING_SEGMENTS);

// Rotate ring to lie flat on XZ plane (RingGeometry defaults to XY)
highlightRingGeo.rotateX(-Math.PI / 2);

const highlightRingMat = new THREE.MeshBasicMaterial({
  color: '#6366f1',
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// ---------------------------------------------------------------------------
// PlacedPrefabItem — memoized single prefab instance
// ---------------------------------------------------------------------------

interface PlacedPrefabItemProps {
  instance: PlacedInstance;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const PlacedPrefabItem = memo(function PlacedPrefabItem({
  instance,
  isSelected,
  onSelect,
}: PlacedPrefabItemProps) {
  const definition = useMemo(
    () => getBuiltinPrefab(instance.prefabId),
    [instance.prefabId],
  );

  const handleClick = useCallback(
    (e: THREE.Event) => {
      // Prevent OrbitControls / canvas pointerMissed from firing
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      onSelect(instance.id);
    },
    [instance.id, onSelect],
  );

  if (!definition) return null;

  return (
    <group
      position={instance.position}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      onClick={handleClick}
    >
      <Prefab3D definition={definition} state="idle" />
      {isSelected && (
        <mesh geometry={highlightRingGeo} material={highlightRingMat} position={[0, 0.02, 0]} />
      )}
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

  // Ref for the group that wraps the selected instance (TransformControls target)
  // Cast needed: drei TransformControls expects RefObject<Object3D> (non-nullable)
  const selectedGroupRef = useRef<THREE.Group>(null!);


  // Derive the selected instance data
  const selectedInstance = useMemo(
    () => (selectedId ? instances.find((i) => i.id === selectedId) : undefined),
    [selectedId, instances],
  );

  // TransformControls mode from studio tool
  const transformMode: 'translate' | 'rotate' =
    tool === 'rotate' ? 'rotate' : 'translate';

  // Whether TransformControls should be active
  const transformEnabled =
    selectedInstance != null && (tool === 'move' || tool === 'rotate');

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
      // Read world position from the group
      const pos = new THREE.Vector3();
      group.getWorldPosition(pos);
      updatePosition(selectedId, [pos.x, pos.y, pos.z]);
    } else {
      // Read Y rotation (euler) and snap to nearest 90-degree increment
      const euler = new THREE.Euler();
      euler.setFromQuaternion(group.quaternion, 'YXZ');
      const degrees = THREE.MathUtils.radToDeg(euler.y);
      // Snap to 0/90/180/270
      const snapped = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
      updateRotation(selectedId, snapped as 0 | 90 | 180 | 270);
    }

    invalidate();
  }, [selectedId, transformMode, updatePosition, updateRotation, invalidate]);

  // Non-selected instances (rendered as memoized items)
  const nonSelectedInstances = useMemo(
    () => instances.filter((i) => i.id !== selectedId),
    [instances, selectedId],
  );

  // Selected instance definition
  const selectedDefinition = useMemo(
    () => (selectedInstance ? getBuiltinPrefab(selectedInstance.prefabId) : undefined),
    [selectedInstance?.prefabId],
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
        />
      ))}

      {/* Selected instance — rendered in its own group for TransformControls attachment */}
      {selectedInstance && selectedDefinition && (
        <group
          ref={selectedGroupRef}
          position={selectedInstance.position}
          rotation={[0, (selectedInstance.rotation * Math.PI) / 180, 0]}
          onClick={(e) => {
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
          object={selectedGroupRef}
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
