/**
 * 3D Scene Editor — barrel export.
 *
 * Game-style editor mode for the Offisim office scene.
 * Provides prefab palette, placement, selection, and properties editing.
 */

export { EditorProvider, useEditor, useEditorMaybe } from './EditorMode.js';
export type { EditorState, EditorActions, PlacedPrefab, EditorTool } from './EditorMode.js';

export { EditorToolbar } from './EditorToolbar.js';
export { PrefabPalette } from './PrefabPalette.js';
export { GhostPrefab } from './GhostPrefab.js';
export { SelectionOutline } from './SelectionOutline.js';
export { PropertiesPanel } from './PropertiesPanel.js';
export { EditorGrid } from './EditorGrid.js';
export { EditorPlacedPrefabs } from './EditorPlacedPrefabs.js';
