import {
  OfficeEditorController,
  type EditorTool,
  type EditorStateSnapshot,
  type OfficeTheme,
  type OfficeTemplate,
  type RoomType,
  type SceneEventBus,
} from '@aics/renderer';
import type { ZoneType } from '@aics/renderer';
import {
  DoorOpen,
  Laptop,
  MousePointer,
  Save,
  Square,
  Trash2,
  Eye,
  EyeOff,
  FolderOpen,
  X,
  ChevronDown,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';
import { useAicsRuntime } from '../../runtime/aics-runtime-context.js';

// ── Zone type options ──
const ZONE_TYPE_OPTIONS: Array<{ value: ZoneType; label: string; labelEn: string }> = [
  { value: 'department', label: '开发部门', labelEn: 'DEV' },
  { value: 'department', label: '产品部门', labelEn: 'PROD' },
  { value: 'department', label: '美术部门', labelEn: 'ART' },
  { value: 'department', label: '自定义部门', labelEn: 'CUSTOM' },
  { value: 'library', label: '图书馆', labelEn: 'LIB' },
  { value: 'rest_area', label: '休息区', labelEn: 'REST' },
  { value: 'meeting_room', label: '会议室', labelEn: 'MTG' },
];

const ROOM_TYPE_OPTIONS: Array<{ value: RoomType; label: string }> = [
  { value: 'meeting_room', label: 'Meeting Room' },
  { value: 'library', label: 'Library' },
  { value: 'rest_area', label: 'Break Area' },
  { value: 'server_room', label: 'Server Room' },
];

const THEME_OPTIONS: Array<{ value: OfficeTheme; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'warm', label: 'Warm' },
];

// ── Tool config ──
const TOOLS: Array<{ tool: EditorTool; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { tool: 'select', label: 'Select', Icon: MousePointer },
  { tool: 'draw-zone', label: 'Draw Zone', Icon: Square },
  { tool: 'place-desk', label: 'Place Desk', Icon: Laptop },
  { tool: 'place-room', label: 'Place Room', Icon: DoorOpen },
];

/** Full 2D spatial office layout editor. */
export function OfficeEditor() {
  const { eventBus } = useAicsRuntime();
  const { createLayout, updateLayout, layouts, activeLayout, loading, setActive, deleteLayout } =
    useOfficeLayout();
  const canvasRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<OfficeEditorController | null>(null);

  // Editor state synced from the PixiJS controller
  const [editorState, setEditorState] = useState<EditorStateSnapshot | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [zoneTypeIdx, setZoneTypeIdx] = useState(0);
  const [roomTypeIdx, setRoomTypeIdx] = useState(0);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  // ── Mount / Unmount editor ──
  useEffect(() => {
    if (!isEditorOpen || !canvasRef.current || !eventBus) return;

    const controller = new OfficeEditorController(
      canvasRef.current,
      eventBus as SceneEventBus,
    );
    controllerRef.current = controller;

    // Listen for state changes
    const unsub = (eventBus as SceneEventBus).on('editor.state.changed', (event) => {
      setEditorState(event.payload as EditorStateSnapshot);
    });

    controller.mount().catch((err) => {
      console.error('[OfficeEditor] mount failed:', err);
    });

    // Load active layout into editor if available
    if (activeLayout) {
      try {
        const config = JSON.parse(activeLayout.layout_json);
        if (config.editorTemplate) {
          controller.loadTemplate(config.editorTemplate as OfficeTemplate);
        }
      } catch {
        /* ignore */
      }
    }

    return () => {
      unsub();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [isEditorOpen, eventBus, activeLayout]);

  // ── Command helpers ──
  const sendCommand = useCallback(
    (action: string, extra?: Record<string, unknown>) => {
      if (!eventBus) return;
      (eventBus as SceneEventBus).emit({
        type: 'editor.command',
        entityId: '',
        entityType: 'employee',
        companyId: '',
        timestamp: Date.now(),
        payload: { action, ...extra },
      });
    },
    [eventBus],
  );

  const handleSetTool = (tool: EditorTool) => {
    sendCommand('setTool', { tool });
    // Update zone/room type when switching tools
    if (tool === 'draw-zone') {
      const opt = ZONE_TYPE_OPTIONS[zoneTypeIdx];
      if (opt) sendCommand('setZoneType', { zoneType: opt.value, zoneLabelEn: opt.labelEn });
    }
    if (tool === 'place-room') {
      const opt = ROOM_TYPE_OPTIONS[roomTypeIdx];
      if (opt) sendCommand('setRoomType', { roomType: opt.value });
    }
  };

  const handleSetTheme = (theme: OfficeTheme) => {
    sendCommand('setTheme', { theme });
  };

  const handleToggleGrid = () => {
    sendCommand('setGridVisible', { gridVisible: !(editorState?.gridVisible ?? true) });
  };

  const handleZoneTypeChange = (idx: number) => {
    setZoneTypeIdx(idx);
    const opt = ZONE_TYPE_OPTIONS[idx];
    if (opt) sendCommand('setZoneType', { zoneType: opt.value, zoneLabelEn: opt.labelEn });
  };

  const handleRoomTypeChange = (idx: number) => {
    setRoomTypeIdx(idx);
    const opt = ROOM_TYPE_OPTIONS[idx];
    if (opt) sendCommand('setRoomType', { roomType: opt.value });
  };

  const handleLoadTemplate = (template: OfficeTemplate) => {
    sendCommand('loadTemplate', { template });
    setShowTemplateMenu(false);
  };

  const handleSaveLayout = async () => {
    if (!controllerRef.current) return;
    const template = controllerRef.current.exportTemplate('Custom Layout');
    const config = {
      type: 'editor-layout',
      editorTemplate: template,
      zones: template.zones,
    };
    const json = JSON.stringify(config);

    if (activeLayout) {
      await updateLayout(activeLayout.layout_id, { layout_json: json });
    } else {
      const id = await createLayout('Custom Office', json);
      await setActive(id);
    }
  };

  const handleDeleteSelected = () => {
    if (!editorState) return;
    const sel = editorState.selection;
    if (sel.kind === 'zone') sendCommand('removeZone', { zoneId: sel.id });
    if (sel.kind === 'desk') sendCommand('removeDesk', { deskId: sel.id });
    if (sel.kind === 'room') sendCommand('removeRoom', { roomId: sel.id });
  };

  // ── Selection info ──
  const sel = editorState?.selection ?? { kind: 'none' as const };
  const selectedZone = sel.kind === 'zone' ? editorState?.zones.find((z) => z.id === sel.id) : null;
  const selectedDesk = sel.kind === 'desk' ? editorState?.desks.find((d) => d.id === sel.id) : null;
  const selectedRoom = sel.kind === 'room' ? editorState?.rooms.find((r) => r.id === sel.id) : null;

  // ── Non-editor view (layout list) ──
  if (!isEditorOpen) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">Office Layout</h3>
          <button
            type="button"
            onClick={() => setIsEditorOpen(true)}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
          >
            Open Editor
          </button>
        </div>

        {loading && <div className="text-xs text-zinc-400">Loading...</div>}

        {/* Layout list */}
        {layouts.length === 0 ? (
          <p className="text-xs text-zinc-500">No layouts yet. Open the editor to create one.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {layouts.map((layout) => {
              const isActive = activeLayout?.layout_id === layout.layout_id;
              let config: { zones?: unknown[] } = {};
              try {
                config = JSON.parse(layout.layout_json);
              } catch {
                /* ignore */
              }
              const zoneCount = Array.isArray(config.zones) ? config.zones.length : 0;

              return (
                <div
                  key={layout.layout_id}
                  className={`rounded border p-2 ${
                    isActive ? 'border-blue-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-zinc-200">{layout.name}</span>
                      <span className="ml-2 text-xs text-zinc-500">{zoneCount} zones</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isActive ? (
                        <span className="text-xs text-blue-400">Active</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setActive(layout.layout_id)}
                            className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                          >
                            Activate
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLayout(layout.layout_id)}
                            className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-700"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Editor view ──
  const builtInTemplates = OfficeEditorController.getBuiltInTemplates();

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* ── Top Toolbar ── */}
      <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1.5">
        {/* Tool buttons */}
        {TOOLS.map(({ tool, label, Icon }) => (
          <button
            key={tool}
            type="button"
            onClick={() => handleSetTool(tool)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              editorState?.tool === tool
                ? 'bg-blue-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-zinc-700" />

        {/* Grid toggle */}
        <button
          type="button"
          onClick={handleToggleGrid}
          className={`rounded p-1 text-xs ${
            editorState?.gridVisible ? 'text-blue-400' : 'text-zinc-500'
          } hover:bg-zinc-800`}
          title="Toggle Grid"
        >
          {editorState?.gridVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>

        <div className="flex-1" />

        {/* Save */}
        <button
          type="button"
          onClick={handleSaveLayout}
          className="flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-600"
          title="Save Layout"
        >
          <Save className="h-3.5 w-3.5" />
          <span>Save</span>
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={() => setIsEditorOpen(false)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="Close Editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: Zone List + Templates ── */}
        <div className="flex w-52 flex-col border-r border-zinc-800 bg-zinc-900">
          {/* Zone List */}
          <div className="flex-1 overflow-y-auto p-2">
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Zones ({editorState?.zones.length ?? 0})
            </h4>
            {editorState?.zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => sendCommand('selectZone', { zoneId: zone.id })}
                className={`mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                  sel.kind === 'zone' && sel.id === zone.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: `#${zone.floorColor.toString(16).padStart(6, '0')}` }}
                />
                <span className="flex-1 truncate">{zone.labelEn}</span>
                <span className="text-[10px] text-zinc-600">{zone.label}</span>
              </button>
            ))}

            <h4 className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Rooms ({editorState?.rooms.length ?? 0})
            </h4>
            {editorState?.rooms.map((room) => (
              <div
                key={room.id}
                className="mb-1 flex items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-400"
              >
                <DoorOpen className="h-3 w-3" />
                <span className="flex-1 truncate">{room.label}</span>
              </div>
            ))}

            <h4 className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Desks ({editorState?.desks.length ?? 0})
            </h4>
          </div>

          {/* Templates */}
          <div className="border-t border-zinc-800 p-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                className="flex w-full items-center justify-between rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                <span className="flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  Templates
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>

              {showTemplateMenu && (
                <div className="absolute bottom-full left-0 mb-1 w-full rounded border border-zinc-700 bg-zinc-800 shadow-lg">
                  {builtInTemplates.map((tmpl) => (
                    <button
                      key={tmpl.name}
                      type="button"
                      onClick={() => handleLoadTemplate(tmpl)}
                      className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
                    >
                      {tmpl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme selector */}
            <div className="mt-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Theme
              </label>
              <div className="flex gap-1">
                {THEME_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleSetTheme(value)}
                    className={`flex-1 rounded px-1.5 py-1 text-[10px] ${
                      editorState?.theme === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div className="flex-1 overflow-hidden" ref={canvasRef} />

        {/* ── Right Panel: Properties ── */}
        <div className="flex w-52 flex-col border-l border-zinc-800 bg-zinc-900 p-2">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Properties
          </h4>

          {/* Tool-specific options */}
          {editorState?.tool === 'draw-zone' && (
            <div className="mb-3">
              <label className="mb-1 block text-[10px] text-zinc-500">Zone Type</label>
              <select
                value={zoneTypeIdx}
                onChange={(e) => handleZoneTypeChange(Number(e.target.value))}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              >
                {ZONE_TYPE_OPTIONS.map((opt, i) => (
                  <option key={`${opt.value}-${opt.labelEn}`} value={i}>
                    {opt.labelEn} - {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {editorState?.tool === 'place-room' && (
            <div className="mb-3">
              <label className="mb-1 block text-[10px] text-zinc-500">Room Type</label>
              <select
                value={roomTypeIdx}
                onChange={(e) => handleRoomTypeChange(Number(e.target.value))}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
              >
                {ROOM_TYPE_OPTIONS.map((opt, i) => (
                  <option key={opt.value} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selected element properties */}
          {sel.kind === 'none' && (
            <p className="text-xs text-zinc-500">Select an element to edit its properties.</p>
          )}

          {selectedZone && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Type</label>
                <span className="text-xs text-zinc-300">{selectedZone.type}</span>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Label</label>
                <span className="text-xs text-zinc-300">{selectedZone.labelEn} - {selectedZone.label}</span>
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">X</label>
                  <span className="text-xs text-zinc-300">{selectedZone.x}</span>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">Y</label>
                  <span className="text-xs text-zinc-300">{selectedZone.y}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">W</label>
                  <span className="text-xs text-zinc-300">{selectedZone.width}</span>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">H</label>
                  <span className="text-xs text-zinc-300">{selectedZone.height}</span>
                </div>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Desks in zone</label>
                <span className="text-xs text-zinc-300">
                  {editorState?.desks.filter((d) => d.zoneId === selectedZone.id).length ?? 0}
                </span>
              </div>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="mt-1 flex items-center gap-1 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400 hover:bg-red-900/50"
              >
                <Trash2 className="h-3 w-3" />
                Delete Zone
              </button>
            </div>
          )}

          {selectedDesk && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Desk ID</label>
                <span className="text-xs font-mono text-zinc-300">{selectedDesk.id}</span>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Zone</label>
                <span className="text-xs text-zinc-300">{selectedDesk.zoneId}</span>
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">X</label>
                  <span className="text-xs text-zinc-300">{selectedDesk.x}</span>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">Y</label>
                  <span className="text-xs text-zinc-300">{selectedDesk.y}</span>
                </div>
              </div>
              {selectedDesk.rackId && (
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">Rack</label>
                  <span className="text-xs text-zinc-300">{selectedDesk.rackId}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="mt-1 flex items-center gap-1 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400 hover:bg-red-900/50"
              >
                <Trash2 className="h-3 w-3" />
                Delete Desk
              </button>
            </div>
          )}

          {selectedRoom && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Room Type</label>
                <span className="text-xs text-zinc-300">{selectedRoom.type}</span>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] text-zinc-500">Label</label>
                <span className="text-xs text-zinc-300">{selectedRoom.label}</span>
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">X</label>
                  <span className="text-xs text-zinc-300">{selectedRoom.x}</span>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">Y</label>
                  <span className="text-xs text-zinc-300">{selectedRoom.y}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">W</label>
                  <span className="text-xs text-zinc-300">{selectedRoom.width}</span>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-zinc-500">H</label>
                  <span className="text-xs text-zinc-300">{selectedRoom.height}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="mt-1 flex items-center gap-1 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400 hover:bg-red-900/50"
              >
                <Trash2 className="h-3 w-3" />
                Delete Room
              </button>
            </div>
          )}

          {/* Keyboard shortcuts help */}
          <div className="mt-auto border-t border-zinc-800 pt-2">
            <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Shortcuts
            </h5>
            <div className="flex flex-col gap-0.5 text-[10px] text-zinc-500">
              <span>Esc: Deselect / Cancel</span>
              <span>Del: Delete selected</span>
              <span>Drag: Move element</span>
              <span>Corner handles: Resize</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
