/**
 * OfficeEditorOverlay — "Offisim Studio" (Zone Mode)
 *
 * Game-quality zone editor with preset placement, drag-to-reposition,
 * required zone protection, overlap detection, and zoom/pan.
 */

import type { PrefabDefinition, ZonePreset } from '@aics/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype, getPresetsForArchetype } from '@aics/shared-types';
import {
  ArrowLeft,
  Grid3X3,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import type { EditorZone, PlacedItem } from './editor/types.js';
import { SVG_W, SVG_H, SCALE, toSVG, editorZoneRect, prefabColor } from './editor/types.js';
import { ARCHETYPE_ICONS, LOCK_ICON_PATH, getFloorPatternId, FLOOR_PATTERNS_SVG } from './editor/archetype-visuals.js';
import { useOfficeEditor } from './editor/useOfficeEditor.js';

// ── Props ───────────────────────────────────────────────────────────

export interface OfficeEditorOverlayProps {
  open: boolean;
  onClose: () => void;
}

// Keep exported for legacy compatibility
export interface ZoneLayoutProps {
  accentColor: string;
  workstationCount: number;
  displayName?: string;
  enabled?: boolean;
}
export type ZoneLayoutMap = Record<string, ZoneLayoutProps>;

// ── Component ───────────────────────────────────────────────────────

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const ed = useOfficeEditor(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#020409]">
      {/* ── Top Bar ──────────────────────────────────────────── */}
      <TopBar ed={ed} onClose={onClose} />

      {/* ── Main Content ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <ZonePalette ed={ed} />
        <EditorCanvas ed={ed} />
        <ZoneProperties ed={ed} />
      </div>

      {/* ── Bottom Status Bar ────────────────────────────────── */}
      <StatusBar ed={ed} />

      {/* ── Warning Toast ────────────────────────────────────── */}
      {ed.warning && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[70] rounded-lg border border-amber-500/30 bg-amber-900/90 px-4 py-2 font-mono text-[11px] text-amber-300 shadow-lg">
          {ed.warning}
        </div>
      )}
    </div>
  );
}

// ── Sub-components (inline for now, will extract to files later) ────

type Ed = ReturnType<typeof useOfficeEditor>;

function TopBar({ ed, onClose }: { ed: Ed; onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/50 hover:bg-white/[0.05] hover:text-white/80 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="h-4 w-px bg-white/10" />
        <h1 className="font-mono text-xs font-black uppercase tracking-[0.25em] text-white/90">OFFISIM_STUDIO</h1>
        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-zinc-500">ZONE MODE</span>
        {ed.dirty && (
          <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[9px] text-amber-400">UNSAVED</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center gap-1 mr-2">
          <button type="button" onClick={ed.handleZoomOut} className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"><ZoomOut className="h-3.5 w-3.5" /></button>
          <span className="font-mono text-[9px] text-zinc-500 w-8 text-center">{Math.round(ed.zoom * 100)}%</span>
          <button type="button" onClick={ed.handleZoomIn} className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"><ZoomIn className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={ed.handleZoomFit} className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"><Maximize2 className="h-3.5 w-3.5" /></button>
        </div>
        <button type="button" onClick={ed.handleResetAll} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[10px] text-white/50 hover:bg-white/[0.05] hover:text-white/70 transition-colors">
          <RotateCcw className="h-3 w-3" />Reset
        </button>
        <button type="button" onClick={() => { void ed.handleSave(); }} disabled={ed.saving || !ed.dirty} className="flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-1.5 font-mono text-[10px] font-semibold text-blue-300 hover:bg-blue-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Save className="h-3 w-3" />{ed.saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function ZonePalette({ ed }: { ed: Ed }) {
  return (
    <div className="w-60 shrink-0 border-r border-white/[0.06] bg-[#060a14] flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/[0.06]">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">ZONE_PRESETS</p>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {ZONE_PRESET_GROUPS.map((group) => {
          const isCollapsed = ed.collapsed[group.archetype] ?? false;
          const required = isRequiredArchetype(group.archetype);
          return (
            <div key={group.archetype}>
              <button
                type="button"
                onClick={() => ed.setCollapsed((p) => ({ ...p, [group.archetype]: !p[group.archetype] }))}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-mono text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-[8px] transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>▼</span>
                <span>{group.icon}</span>
                <span className="flex-1">{group.label}</span>
                {required && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[7px] font-bold text-amber-400 tracking-wider">REQUIRED</span>
                )}
                <span className="text-zinc-600">{group.presets.length}</span>
              </button>
              {!isCollapsed && group.presets.map((preset) => (
                <PresetCard key={preset.id} preset={preset} ed={ed} />
              ))}
            </div>
          );
        })}

        {/* Create Custom Zone */}
        <div className="border-t border-white/[0.06] mt-1 pt-1">
          <button type="button" onClick={() => { ed.setShowCustomForm((v) => !v); ed.setPlacingPreset(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-colors">
            <Plus className="h-3 w-3" /><span>Create Custom Zone</span>
          </button>
          {ed.showCustomForm && (
            <div className="px-3 pb-2 space-y-2">
              <input type="text" value={ed.customLabel} onChange={(e) => ed.setCustomLabel(e.target.value)} placeholder="Zone name..." className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50" />
              <select value={ed.customArchetype} onChange={(e) => ed.setCustomArchetype(e.target.value as 'workspace')} className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50">
                <option value="workspace">Workspace</option>
                <option value="meeting">Meeting</option>
                <option value="library">Library</option>
                <option value="rest">Rest Area</option>
                <option value="server">Server</option>
              </select>
              <button type="button" onClick={ed.handleCreateCustom} className="w-full rounded border border-blue-500/30 bg-blue-600/15 py-1.5 font-mono text-[10px] text-blue-300 hover:bg-blue-600/25 transition-colors">Add to Canvas</button>
            </div>
          )}
        </div>
      </div>

      {/* Placement hint */}
      {ed.placingPreset && (
        <div className="border-t border-white/[0.06] px-3 py-2 bg-blue-500/5">
          <p className="font-mono text-[9px] text-blue-400">Placing: <strong>{ed.placingPreset.label}</strong></p>
          <p className="font-mono text-[8px] text-zinc-600 mt-0.5">Click on canvas to place · ESC to cancel</p>
        </div>
      )}
    </div>
  );
}

function PresetCard({ preset, ed }: { preset: ZonePreset; ed: Ed }) {
  const isActive = ed.placingPreset?.id === preset.id;
  const required = isRequiredArchetype(preset.archetype);
  return (
    <button
      type="button"
      onClick={() => ed.handlePresetClick(preset)}
      className={`flex w-full items-center gap-2.5 px-2 py-2 pl-6 text-left transition-all ${
        isActive
          ? 'bg-blue-500/15 text-blue-300 border-l-2 border-blue-500'
          : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border-l-2 border-transparent'
      }`}
    >
      {/* Color swatch + archetype mini icon */}
      <div className="relative shrink-0">
        <div className="h-8 w-8 rounded" style={{ backgroundColor: `${preset.accentColor}20`, border: `1.5px solid ${preset.accentColor}40` }}>
          {/* Mini zone size preview */}
          <div
            className="absolute rounded-sm"
            style={{
              backgroundColor: `${preset.accentColor}50`,
              width: `${Math.min(preset.w / 20 * 100, 100)}%`,
              height: `${Math.min(preset.d / 12 * 100, 100)}%`,
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        </div>
        {required && (
          <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-500/80 flex items-center justify-center">
            <Lock className="h-1.5 w-1.5 text-amber-900" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="block truncate font-mono text-[10px] font-medium">{preset.label}</span>
        <span className="block font-mono text-[8px] text-zinc-600">
          {preset.w}x{preset.d} · {preset.prefabs.length} items
          {preset.deskSlots > 0 && ` · ${preset.deskSlots} desks`}
        </span>
      </div>
    </button>
  );
}

function EditorCanvas({ ed }: { ed: Ed }) {
  return (
    <div
      className="flex-1 flex items-center justify-center overflow-hidden bg-[#020409]"
      style={{ cursor: ed.placingPreset ? 'crosshair' : ed.drag ? 'grabbing' : 'default' }}
    >
      <svg
        ref={ed.svgRef}
        viewBox={ed.viewBox}
        className="h-full max-h-[calc(100vh-7rem)] w-full max-w-[1200px]"
        onPointerDown={ed.handleCanvasPointerDown}
        onMouseMove={ed.handleCanvasMouseMove}
        onPointerUp={ed.handleCanvasPointerUp}
        onMouseLeave={ed.handleCanvasMouseLeave}
        onWheel={ed.handleWheel}
      >
        <title>Office editor canvas</title>
        <defs>
          <pattern id="studio-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="0.5" cy="0.5" r="0.4" fill="rgba(255,255,255,0.06)" />
          </pattern>
          {/* Floor patterns are injected as raw SVG */}
          <g dangerouslySetInnerHTML={{ __html: FLOOR_PATTERNS_SVG }} />
        </defs>
        <rect width={SVG_W} height={SVG_H} fill="url(#studio-grid)" />

        {/* Zones */}
        {ed.editorZones.map((z) => (
          <ZoneBlock
            key={z.id}
            zone={z}
            items={ed.itemsByZone.get(z.id) ?? []}
            isSelected={ed.selectedZoneId === z.id}
            isDragging={ed.drag?.zoneId === z.id}
            hasOverlap={ed.overlapMap.has(z.id)}
            allPrefabsMap={ed.allPrefabsMap}
            placingPreset={ed.placingPreset}
            onPointerDown={ed.handleZonePointerDown}
          />
        ))}

        {/* Ghost preview */}
        {ed.placingPreset && ed.ghostPos && (
          <GhostPreview preset={ed.placingPreset} ghostPos={ed.ghostPos} overlaps={ed.ghostOverlaps} />
        )}
      </svg>
    </div>
  );
}

function ZoneBlock({
  zone: z, items, isSelected, isDragging, hasOverlap, allPrefabsMap, placingPreset, onPointerDown,
}: {
  zone: EditorZone;
  items: PlacedItem[];
  isSelected: boolean;
  isDragging: boolean;
  hasOverlap: boolean;
  allPrefabsMap: Map<string, PrefabDefinition>;
  placingPreset: ZonePreset | null;
  onPointerDown: (zoneId: string, e: React.PointerEvent) => void;
}) {
  const r = editorZoneRect(z);
  const required = isRequiredArchetype(z.archetype);
  const patternId = getFloorPatternId(z.archetype);
  const archIcon = z.archetype ? ARCHETYPE_ICONS[z.archetype] : null;

  return (
    <g>
      {/* Floor pattern */}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5} fill={`${z.accentColor}0a`} />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5} fill={`url(#${patternId})`} style={{ color: z.accentColor }} />

      {/* Zone border */}
      <rect
        x={r.x} y={r.y} width={r.w} height={r.h} rx={5}
        fill="none"
        stroke={isSelected ? z.accentColor : `${z.accentColor}30`}
        strokeWidth={isSelected ? 2 : 1}
        strokeDasharray={isDragging ? '4 2' : undefined}
        style={{ cursor: placingPreset ? 'crosshair' : 'grab' }}
        onPointerDown={(e) => onPointerDown(z.id, e)}
      />

      {/* Top accent bar */}
      <rect x={r.x} y={r.y} width={r.w} height={3} fill={z.accentColor} opacity={isSelected ? 0.9 : 0.5} rx={5} style={{ pointerEvents: 'none' }} />

      {/* Zone label + lock icon */}
      <g style={{ pointerEvents: 'none' }}>
        {required && (
          <g transform={`translate(${r.x + 6}, ${r.y + 8})`}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={z.accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
              <path d={LOCK_ICON_PATH} />
            </svg>
          </g>
        )}
        <text
          x={r.x + (required ? 18 : 6)} y={r.y + 14}
          fill={z.accentColor} fontSize="8" fontFamily="monospace" fontWeight="700" letterSpacing="0.1em" opacity={0.8}
        >
          {z.label.toUpperCase()}
        </text>
      </g>

      {/* Archetype icon (top-right) */}
      {archIcon && (
        <g transform={`translate(${r.x + r.w - 16}, ${r.y + 6})`} style={{ pointerEvents: 'none' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={z.accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <path d={archIcon.path} />
          </svg>
        </g>
      )}

      {/* Size hint */}
      <text x={r.x + r.w - 6} y={r.y + r.h - 4} textAnchor="end" fill={`${z.accentColor}30`} fontSize="7" fontFamily="monospace" style={{ pointerEvents: 'none' }}>
        {z.w}x{z.d}
      </text>

      {/* Furniture */}
      {items.map((item) => {
        const def = allPrefabsMap.get(item.prefabId);
        if (!def) return null;
        const { sx, sy } = toSVG(item.x, item.y);
        const color = prefabColor(def.category);
        const halfW = (def.gridSize[0] * SCALE) / 2;
        const halfH = (def.gridSize[1] * SCALE) / 2;
        return (
          <g key={item.instanceId} transform={`translate(${sx}, ${sy}) rotate(${item.rotation})`} style={{ pointerEvents: 'none' }}>
            <rect x={-halfW} y={-halfH} width={halfW * 2} height={halfH * 2} rx={2} fill={`${color}18`} stroke={`${color}50`} strokeWidth={0.8} />
            <line x1={0} y1={-halfH} x2={0} y2={-halfH - 3} stroke={color} strokeWidth={1.5} opacity={0.4} />
            <text x={0} y={2} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="6" fontFamily="monospace" fontWeight="500" opacity={0.7}>
              {def.name.split(' ')[0]}
            </text>
          </g>
        );
      })}

      {/* Overlap warning overlay */}
      {hasOverlap && (
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5} fill="url(#overlap-hatch)" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" style={{ pointerEvents: 'none' }} />
      )}

      {/* Selection handles */}
      {isSelected && (
        <>
          <rect x={r.x - 1} y={r.y - 1} width={r.w + 2} height={r.h + 2} rx={6} fill="none" stroke={z.accentColor} strokeWidth={1.5} strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />
          {[[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={z.accentColor} opacity={0.6} style={{ pointerEvents: 'none' }} />
          ))}
        </>
      )}
    </g>
  );
}

function GhostPreview({ preset, ghostPos, overlaps }: { preset: ZonePreset; ghostPos: { x: number; y: number }; overlaps: string[] }) {
  const hasOverlap = overlaps.length > 0;
  const color = hasOverlap ? '#ef4444' : '#22c55e';
  return (
    <g transform={`translate(${ghostPos.x}, ${ghostPos.y})`} style={{ pointerEvents: 'none' }}>
      <rect
        x={-(preset.w * SCALE) / 2} y={-(preset.d * SCALE) / 2}
        width={preset.w * SCALE} height={preset.d * SCALE}
        rx={5} fill={`${color}08`} stroke={color} strokeWidth={1.5} strokeDasharray="6 4"
      />
      {hasOverlap && (
        <rect
          x={-(preset.w * SCALE) / 2} y={-(preset.d * SCALE) / 2}
          width={preset.w * SCALE} height={preset.d * SCALE}
          rx={5} fill="url(#overlap-hatch)"
        />
      )}
      <text x={0} y={-4} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="700" opacity={0.6}>
        {preset.label.toUpperCase()}
      </text>
      <text x={0} y={8} textAnchor="middle" dominantBaseline="middle" fill={color} fontSize="7" fontFamily="monospace" opacity={0.4}>
        {preset.w}x{preset.d} · {preset.prefabs.length} items
      </text>
      {hasOverlap && (
        <text x={0} y={20} textAnchor="middle" dominantBaseline="middle" fill="#ef4444" fontSize="7" fontFamily="monospace" fontWeight="600" opacity={0.8}>
          Overlaps: {overlaps.join(', ')}
        </text>
      )}
    </g>
  );
}

function ZoneProperties({ ed }: { ed: Ed }) {
  const z = ed.selectedZone;
  const variants = z?.archetype ? getPresetsForArchetype(z.archetype) : [];

  return (
    <div className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-200 overflow-hidden ${z ? 'w-64 opacity-100' : 'w-0 opacity-0 border-l-0'}`}>
      {z && (
        <>
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">ZONE</h2>
              {ed.selectedZoneRequired && (
                <span className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[7px] font-bold text-amber-400">
                  <Lock className="h-2 w-2" />REQUIRED
                </span>
              )}
            </div>
            <button type="button" onClick={() => ed.setSelectedZoneId(null)} className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Name */}
            <div>
              <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Name</p>
              <input type="text" value={z.label} onChange={(e) => ed.handleLabelChange(e.target.value)} className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500/50" />
            </div>

            {/* Archetype */}
            <div>
              <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Type</p>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: z.accentColor }} />
                <span className="font-mono text-xs text-zinc-300 capitalize">{z.archetype ?? 'none'}</span>
              </div>
            </div>

            {/* Variant swap (for zones with multiple preset options) */}
            {variants.length > 1 && (
              <div>
                <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Variant</p>
                <select
                  value={z.presetId ?? ''}
                  onChange={(e) => {
                    const p = variants.find((v) => v.id === e.target.value);
                    if (p) ed.handleSwapVariant(p);
                  }}
                  className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
                >
                  {!z.presetId && <option value="">Current</option>}
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.label} ({v.w}x{v.d})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Size */}
            <div>
              <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Size</p>
              <p className="font-mono text-xs text-zinc-300">{z.w} x {z.d} units</p>
            </div>

            {/* Position */}
            <div>
              <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-2">Position</p>
              <div className="grid grid-cols-2 gap-2">
                {(['X', 'Z'] as const).map((axis) => (
                  <div key={axis}>
                    <span className="font-mono text-[8px] text-zinc-600">{axis}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <button type="button" onClick={() => ed.handleMoveZone(axis === 'X' ? -1 : 0, axis === 'Z' ? -1 : 0)} className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300">
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">{axis === 'X' ? z.cx : z.cz}</span>
                      <button type="button" onClick={() => ed.handleMoveZone(axis === 'X' ? 1 : 0, axis === 'Z' ? 1 : 0)} className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300">
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Furniture */}
            <div>
              <p className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Furniture</p>
              <p className="font-mono text-xs text-zinc-300">{ed.itemsByZone.get(z.id)?.length ?? 0} items</p>
              {z.deskSlots > 0 && <p className="font-mono text-[9px] text-zinc-500 mt-0.5">{z.deskSlots} desk slots</p>}
            </div>

            {/* Delete */}
            <button
              type="button"
              onClick={ed.handleDeleteZone}
              disabled={ed.selectedZoneRequired}
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-[10px] transition-colors ${
                ed.selectedZoneRequired
                  ? 'border-zinc-700 bg-zinc-800/30 text-zinc-600 cursor-not-allowed'
                  : 'border-red-500/30 bg-red-600/10 text-red-400 hover:bg-red-600/20'
              }`}
            >
              {ed.selectedZoneRequired ? (
                <><Lock className="h-3 w-3" />Required — Cannot Delete</>
              ) : (
                <><Trash2 className="h-3 w-3" />Delete Zone</>
              )}
            </button>
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2">
            <p className="font-mono text-[8px] text-zinc-700">Drag to move · Del: Delete · Esc: Deselect</p>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBar({ ed }: { ed: Ed }) {
  const overlapCount = ed.overlapMap.size;
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/[0.06] px-4">
      <div className="flex items-center gap-3">
        <p className="font-mono text-[9px] text-zinc-600">
          {ed.editorZones.length} zones · {ed.localItems.length} items
          {ed.placingPreset && ` · Placing: ${ed.placingPreset.label}`}
          {ed.drag && ' · Dragging...'}
        </p>
        {overlapCount > 0 && (
          <span className="rounded bg-red-500/15 px-2 py-0.5 font-mono text-[9px] text-red-400">
            {overlapCount} overlap{overlapCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="font-mono text-[9px] text-zinc-700">
        <Grid3X3 className="inline h-3 w-3 mr-1" />
        {Math.round(ed.zoom * 100)}% · {SCALE}px/unit
      </p>
    </div>
  );
}
