import { EditorToolbar } from './editor/EditorToolbar.js';
import { PresetPalette } from './editor/PresetPalette.js';
import { StatusBar } from './editor/StatusBar.js';
import { ValidationBanner } from './editor/ValidationBanner.js';
import { ZoneCanvas } from './editor/ZoneCanvas.js';
import { ZoneInspector } from './editor/ZoneInspector.js';
import { useDragReposition } from './editor/hooks/useDragReposition.js';
import { useZoneEditorState } from './editor/hooks/useZoneEditorState.js';
import { useZonePanZoom } from './editor/hooks/useZonePanZoom.js';
import { useZoneValidation } from './editor/hooks/useZoneValidation.js';

export interface OfficeEditorOverlayProps {
  open: boolean;
  onClose: () => void;
}

export interface ZoneLayoutProps {
  accentColor: string;
  workstationCount: number;
  displayName?: string;
  enabled?: boolean;
}
export type ZoneLayoutMap = Record<string, ZoneLayoutProps>;

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const viewport = useZonePanZoom(open);
  const state = useZoneEditorState({ open, onClose });
  const drag = useDragReposition({
    placingPreset: state.placingPreset,
    editorZones: state.editorZones,
    zoomRef: viewport.zoomRef,
    panXRef: viewport.panXRef,
    panYRef: viewport.panYRef,
    setSelectedZoneId: state.setSelectedZoneId,
    setDirty: state.setDirty,
  });
  const validation = useZoneValidation({
    editorZones: state.editorZones,
    drag: drag.drag,
    placingPreset: state.placingPreset,
    ghostPos: drag.ghostPos,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#020409]">
      <EditorToolbar
        selectedZoneLabel={state.selectedZone?.label ?? null}
        dirty={state.dirty}
        saving={state.saving}
        zoom={viewport.zoom}
        onZoomIn={viewport.handleZoomIn}
        onZoomOut={viewport.handleZoomOut}
        onZoomFit={viewport.handleZoomFit}
        onResetAll={state.handleResetAll}
        onSave={() => {
          void state.handleSave();
        }}
        onClose={onClose}
      />

      <div className="flex flex-1 overflow-hidden">
        <PresetPalette
          collapsed={state.collapsed}
          placingPreset={state.placingPreset}
          showCustomForm={state.showCustomForm}
          customLabel={state.customLabel}
          customArchetype={state.customArchetype}
          setCollapsed={state.setCollapsed}
          setShowCustomForm={state.setShowCustomForm}
          setCustomLabel={state.setCustomLabel}
          setCustomArchetype={state.setCustomArchetype}
          setPlacingPreset={state.setPlacingPreset}
          onPresetClick={state.handlePresetClick}
          onCreateCustom={state.handleCreateCustom}
        />
        <ZoneCanvas
          viewBox={viewport.viewBox}
          editorZones={state.editorZones}
          itemsByZone={state.itemsByZone}
          selectedZoneId={state.selectedZoneId}
          drag={drag.drag}
          overlapMap={validation.overlapMap}
          allPrefabsMap={state.allPrefabsMap}
          placingPreset={state.placingPreset}
          ghostPos={drag.ghostPos}
          ghostOverlaps={validation.ghostOverlaps}
          svgRef={drag.svgRef}
          onCanvasPointerDown={drag.handleCanvasPointerDown}
          onCanvasMouseMove={drag.handleCanvasMouseMove}
          onCanvasPointerUp={drag.handleCanvasPointerUp}
          onCanvasMouseLeave={drag.handleCanvasMouseLeave}
          onWheel={viewport.handleWheel}
          onZonePointerDown={drag.handleZonePointerDown}
        />
        <ZoneInspector
          zone={state.selectedZone}
          selectedZoneRequired={state.selectedZoneRequired}
          itemCount={
            state.selectedZone ? (state.itemsByZone.get(state.selectedZone.id)?.length ?? 0) : 0
          }
          onLabelChange={state.handleLabelChange}
          onMoveZone={state.handleMoveZone}
          onSwapVariant={state.handleSwapVariant}
          onDeleteZone={state.handleDeleteZone}
          onDeselect={() => state.setSelectedZoneId(null)}
        />
      </div>

      <StatusBar
        zoneCount={state.editorZones.length}
        itemCount={state.localItems.length}
        placingPresetLabel={state.placingPreset?.label ?? null}
        isDragging={drag.drag !== null}
        overlapCount={validation.overlapMap.size}
        zoom={viewport.zoom}
      />

      <ValidationBanner warning={state.warning} />
    </div>
  );
}
