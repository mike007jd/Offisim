/**
 * EditorPlacedPrefabs — Renders all editor-placed prefabs in the 3D scene.
 *
 * Each placed prefab is interactive: click to select, renders with
 * selection outline when selected. Delete key removes selected prefab.
 *
 * Must be rendered inside R3F Canvas.
 */

import { useEffect, useCallback } from 'react';
import { getBuiltinPrefab } from '@aics/renderer';
import { Prefab3D } from '../prefabs/index.js';
import { SelectionOutline } from './SelectionOutline.js';
import { useEditor } from './EditorMode.js';

export function EditorPlacedPrefabs() {
  const {
    mode,
    placedPrefabs,
    selectedInstanceId,
    selectInstance,
    deleteSelected,
    activeTool,
  } = useEditor();

  const isEdit = mode === 'edit';

  // Delete key handler
  useEffect(() => {
    if (!isEdit) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedInstanceId &&
        // Don't delete if user is typing in an input
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEdit, selectedInstanceId, deleteSelected]);

  // Click handler for placed prefabs
  const handlePrefabClick = useCallback(
    (instanceId: string, e: { stopPropagation: () => void }) => {
      if (!isEdit) return;
      // Don't interfere with placement mode
      if (activeTool === 'place') return;
      e.stopPropagation();
      selectInstance(instanceId);
    },
    [isEdit, activeTool, selectInstance],
  );

  if (placedPrefabs.length === 0) return null;

  return (
    <>
      {placedPrefabs.map((placed) => {
        const definition = getBuiltinPrefab(placed.prefabId);
        if (!definition) return null;

        const isSelected = isEdit && selectedInstanceId === placed.id;

        return (
          <group key={placed.id}>
            {/* Clickable wrapper */}
            <group
              onClick={(e) => handlePrefabClick(placed.id, e)}
              onPointerOver={(e) => {
                if (isEdit && activeTool !== 'place') {
                  e.stopPropagation();
                  document.body.style.cursor = 'pointer';
                }
              }}
              onPointerOut={() => {
                if (isEdit) {
                  document.body.style.cursor = 'default';
                }
              }}
            >
              <Prefab3D
                definition={definition}
                position={placed.position}
                rotation={placed.rotation}
              />
            </group>

            {/* Selection outline */}
            {isSelected && (
              <SelectionOutline
                position={placed.position}
                size={[
                  definition.gridSize[0] * 1.5,
                  definition.gridSize[1] * 1.5,
                ]}
              />
            )}
          </group>
        );
      })}
    </>
  );
}
