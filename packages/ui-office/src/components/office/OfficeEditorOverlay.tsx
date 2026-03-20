import { ArrowLeft, Eye, Grid3X3, Power, RotateCcw, Save, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';
import { useAicsRuntime } from '../../runtime/aics-runtime-context.js';
import { ZONES } from '../../lib/zone-config.js';

// ── Props ───────────────────────────────────────────────────────────

export interface OfficeEditorOverlayProps {
  open: boolean;
  onClose: () => void;
}

// ── Persistent zone properties (saved in layout_json) ───────────────

export interface ZoneLayoutProps {
  accentColor: string;
  workstationCount: number;
  /** Custom display name; falls back to ZoneDef.label when absent or empty. */
  displayName?: string;
  /** Whether this zone is active in the layout. Defaults to true. */
  enabled?: boolean;
}

export type ZoneLayoutMap = Record<string, ZoneLayoutProps>;

// ── Editor-specific zone layout (sublabel, grid position) ───────────

interface ZoneEditorLayout {
  readonly sublabel: string;
  readonly row: number;
  readonly col: number;
  readonly colSpan?: number;
}

const ZONE_EDITOR_LAYOUT: Readonly<Record<string, ZoneEditorLayout>> = {
  dev:  { sublabel: '开发部门', row: 0, col: 0 },
  prod: { sublabel: '产品部门', row: 0, col: 1 },
  art:  { sublabel: '美术部门', row: 0, col: 2 },
  lib:  { sublabel: '图书馆',   row: 1, col: 0 },
  rest: { sublabel: '休息区',   row: 1, col: 1 },
  mtg:  { sublabel: '会议室',   row: 2, col: 0 },
  srv:  { sublabel: '机房',     row: 2, col: 1 },
};

const EDITOR_ZONES = ZONES.filter(z => z.id in ZONE_EDITOR_LAYOUT)
  .map(z => ({ ...z, ...ZONE_EDITOR_LAYOUT[z.id]! }))
  .sort((a, b) => a.row - b.row || a.col - b.col);

// ── Accent color presets ────────────────────────────────────────────

const ACCENT_PRESETS = [
  '#3b82f6', '#a855f7', '#f97316', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#ec4899',
  '#94a3b8', '#84cc16',
] as const;

// ── View modes ──────────────────────────────────────────────────────

type ViewMode = '2d' | '3d';

// ── Default zone props factory ──────────────────────────────────────

function buildDefaultZoneProps(): ZoneLayoutMap {
  const map: ZoneLayoutMap = {};
  for (const zone of EDITOR_ZONES) {
    map[zone.id] = {
      accentColor: zone.accent,
      workstationCount: zone.deskSlots > 0 ? zone.deskSlots : 0,
      displayName: undefined,
      enabled: true,
    };
  }
  return map;
}

/** Parse layout_json from DB into ZoneLayoutMap, merging defaults for missing keys. */
function parseLayoutJson(json: string | null | undefined): ZoneLayoutMap {
  const defaults = buildDefaultZoneProps();
  if (!json) return defaults;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const raw = parsed.zoneProps as Record<string, ZoneLayoutProps> | undefined;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, props] of Object.entries(raw)) {
        if (id in defaults) {
          defaults[id] = { ...defaults[id]!, ...props };
        }
      }
    }
  } catch {
    // ignore — use defaults
  }
  return defaults;
}

/** Serialize ZoneLayoutMap into the canonical layout_json shape, preserving other keys. */
function serializeLayoutJson(
  zoneProps: ZoneLayoutMap,
  existingJson: string | null | undefined,
): string {
  let existing: Record<string, unknown> = {};
  try {
    if (existingJson) existing = JSON.parse(existingJson) as Record<string, unknown>;
  } catch { /* ignore */ }
  return JSON.stringify({ ...existing, zoneProps });
}

// ── Component ───────────────────────────────────────────────────────

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [saving, setSaving] = useState(false);
  const { eventBus } = useAicsRuntime();
  const { activeLayout, createLayout, updateLayout } = useOfficeLayout();

  const [zoneProps, setZoneProps] = useState<ZoneLayoutMap>(buildDefaultZoneProps);

  // Hydrate from DB layout when overlay opens or layout becomes available
  useEffect(() => {
    if (open && activeLayout) {
      setZoneProps(parseLayoutJson(activeLayout.layout_json));
    }
  }, [open, activeLayout]);

  const selectedZone = EDITOR_ZONES.find((z) => z.id === selectedZoneId) ?? null;
  const selectedProps = selectedZoneId ? (zoneProps[selectedZoneId] ?? null) : null;
  const showSidebar = viewMode === '2d' && selectedZone != null && selectedProps != null;

  const handleZoneClick = useCallback((zoneId: string) => {
    setSelectedZoneId((prev) => (prev === zoneId ? null : zoneId));
  }, []);

  const patchSelectedZone = useCallback(
    (patch: Partial<ZoneLayoutProps>) => {
      if (!selectedZoneId) return;
      setZoneProps((prev) => ({
        ...prev,
        [selectedZoneId]: { ...prev[selectedZoneId]!, ...patch },
      }));
    },
    [selectedZoneId],
  );

  const handleToggleEnabled = useCallback(() => {
    if (!selectedZoneId || !selectedProps) return;
    patchSelectedZone({ enabled: !(selectedProps.enabled ?? true) });
  }, [selectedZoneId, selectedProps, patchSelectedZone]);

  const handleResetDefaults = useCallback(() => {
    setZoneProps(buildDefaultZoneProps());
    setSelectedZoneId(null);
  }, []);

  const handleApplyChanges = useCallback(() => {
    if (!selectedZoneId || !selectedProps) return;
    eventBus.emit({
      type: 'office.zone.config.changed',
      entityId: selectedZoneId,
      entityType: 'company',
      companyId: '',
      timestamp: Date.now(),
      payload: {
        zoneId: selectedZoneId,
        accentColor: selectedProps.accentColor,
        workstationCount: selectedProps.workstationCount,
        displayName: selectedProps.displayName,
        enabled: selectedProps.enabled ?? true,
      },
    });
  }, [selectedZoneId, selectedProps, eventBus]);

  const handleSaveLayout = useCallback(async () => {
    setSaving(true);
    try {
      const layoutJson = serializeLayoutJson(zoneProps, activeLayout?.layout_json);
      if (activeLayout) {
        await updateLayout(activeLayout.layout_id, { layout_json: layoutJson });
      } else {
        await createLayout('Default Layout', layoutJson);
      }
      eventBus.emit({
        type: 'office.layout.saved',
        entityId: 'office',
        entityType: 'company',
        companyId: '',
        timestamp: Date.now(),
        payload: { zoneProps },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [zoneProps, activeLayout, updateLayout, createLayout, eventBus, onClose]);

  if (!open) return null;

  const MAP_PADDING = 32;
  const ZONE_GAP = 12;
  const ROW_HEIGHTS = [200, 140, 120];
  const COL_COUNTS = [3, 2, 2];
  const svgWidth = 720;
  const svgHeight = MAP_PADDING * 2 + ROW_HEIGHTS.reduce((a, b) => a + b, 0) + ZONE_GAP * (ROW_HEIGHTS.length - 1);

  function getZoneRect(zone: typeof EDITOR_ZONES[number]) {
    const contentWidth = svgWidth - MAP_PADDING * 2;
    const cols = COL_COUNTS[zone.row] ?? 3;
    const colWidth = (contentWidth - (cols - 1) * ZONE_GAP) / cols;
    const span = zone.colSpan ?? 1;
    const x = MAP_PADDING + zone.col * (colWidth + ZONE_GAP);
    let y = MAP_PADDING;
    for (let r = 0; r < zone.row; r++) {
      y += (ROW_HEIGHTS[r] ?? 0) + ZONE_GAP;
    }
    return { x, y, width: colWidth * span + (span - 1) * ZONE_GAP, height: ROW_HEIGHTS[zone.row] ?? 140 };
  }

  return (
    <div className="h-screen w-screen bg-[#02040a] flex flex-col overflow-hidden">
      {/* ── Top Bar ────────────────────────────────────────────────── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/80"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="h-5 w-px bg-white/10" />
          <h1 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-white/90">
            OFFICE_LAYOUT_EDITOR
          </h1>
          <div className="h-5 w-px bg-white/10" />
          <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              onClick={() => { setViewMode('2d'); }}
              className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
                viewMode === '2d'
                  ? 'bg-blue-500/20 text-blue-400 border-r border-blue-500/30'
                  : 'text-white/40 hover:text-white/60 border-r border-white/10'
              }`}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              2D_EDIT
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('3d'); setSelectedZoneId(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 font-mono text-xs tracking-wider transition-colors ${
                viewMode === '3d'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              3D_PREVIEW
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Map / Preview Area ─────────────────────────────────── */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[#020409]">
          {viewMode === '2d' ? (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="h-full max-h-[calc(100vh-8rem)] w-full max-w-[900px]"
              style={{ filter: 'drop-shadow(0 0 60px rgba(59,130,246,0.05))' }}
            >
              <defs>
                <pattern id="grid-dots" width="40" height="40" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.6" fill="rgba(255,255,255,0.04)" />
                </pattern>
                <filter id="zone-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                  <feFlood floodColor="#3b82f6" floodOpacity="0.4" result="color" />
                  <feComposite in="color" in2="blur" operator="in" result="shadow" />
                  <feMerge>
                    <feMergeNode in="shadow" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="url(#grid-dots)" />

              {EDITOR_ZONES.map((zone) => {
                const { x, y, width, height } = getZoneRect(zone);
                const isSelected = selectedZoneId === zone.id;
                const props = zoneProps[zone.id];
                const accentColor = props?.accentColor ?? zone.accent;
                const isEnabled = props?.enabled ?? true;
                const displayName = props?.displayName?.trim() || zone.label;

                return (
                  <g
                    key={zone.id}
                    onClick={() => handleZoneClick(zone.id)}
                    className="cursor-pointer"
                    filter={isSelected ? 'url(#zone-glow)' : undefined}
                    opacity={isEnabled ? 1 : 0.38}
                  >
                    <rect x={x} y={y} width={width} height={height} rx={6}
                      fill={`${accentColor}10`}
                      stroke={isSelected ? '#3b82f6' : `${accentColor}40`}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <rect x={x} y={y} width={width} height={4} rx={6}
                      fill={accentColor} opacity={isSelected ? 1 : 0.6}
                    />
                    <rect x={x} y={y + 2} width={width} height={2}
                      fill={accentColor} opacity={isSelected ? 1 : 0.6}
                    />
                    {!isEnabled && (
                      <rect x={x} y={y} width={width} height={height} rx={6} fill="rgba(0,0,0,0.5)" />
                    )}
                    <text x={x + width / 2} y={y + height / 2 - 8}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={accentColor} fontSize="18" fontFamily="monospace"
                      fontWeight="700" letterSpacing="0.15em" opacity={isSelected ? 1 : 0.8}
                    >
                      {displayName}
                    </text>
                    <text x={x + width / 2} y={y + height / 2 + 14}
                      textAnchor="middle" dominantBaseline="middle"
                      fill="rgba(255,255,255,0.35)" fontSize="11"
                    >
                      {zone.sublabel}
                    </text>
                    <text x={x + width - 12} y={y + height - 12}
                      textAnchor="end" dominantBaseline="auto"
                      fill="rgba(255,255,255,0.2)" fontSize="10" fontFamily="monospace"
                    >
                      {props?.workstationCount ?? 0} seats
                    </text>
                    {!isEnabled && (
                      <text x={x + 12} y={y + height - 12}
                        textAnchor="start" dominantBaseline="auto"
                        fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" letterSpacing="0.1em"
                      >
                        DISABLED
                      </text>
                    )}
                    {isSelected && (
                      <>
                        <circle cx={x} cy={y} r={3} fill="#3b82f6" />
                        <circle cx={x + width} cy={y} r={3} fill="#3b82f6" />
                        <circle cx={x} cy={y + height} r={3} fill="#3b82f6" />
                        <circle cx={x + width} cy={y + height} r={3} fill="#3b82f6" />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12">
                <Eye className="mx-auto mb-4 h-16 w-16 text-zinc-700" />
                <p className="font-mono text-sm font-semibold tracking-[0.2em] text-zinc-500">
                  3D_PREVIEW
                </p>
                <p className="mt-3 text-xs text-zinc-600">
                  3D 实时预览即将上线 -- 敬请期待
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Sidebar: Zone Properties ── */}
        <div
          className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${
            showSidebar ? 'w-80 min-w-[280px] opacity-100' : 'w-0 opacity-0 border-l-0'
          }`}
        >
          {showSidebar && selectedZone && selectedProps && (
            <>
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <h2 className="font-mono text-xs font-semibold tracking-[0.15em] text-zinc-400">
                  ZONE_PROPERTIES
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedZoneId(null)}
                  className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-zinc-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col overflow-y-auto p-5">
                {/* Zone name editable */}
                <div className="mb-5">
                  <label
                    htmlFor="zone-display-name"
                    className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500"
                  >
                    Zone Name
                  </label>
                  <input
                    id="zone-display-name"
                    type="text"
                    value={selectedProps.displayName ?? selectedZone.label}
                    onChange={(e) => patchSelectedZone({ displayName: e.target.value })}
                    placeholder={selectedZone.label}
                    className="w-full rounded border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-mono text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500/50"
                  />
                  <p className="mt-1 font-mono text-[9px] text-zinc-600">
                    Default: {selectedZone.label}
                  </p>
                </div>

                {/* Space type */}
                <div className="mb-5">
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Space Type
                  </label>
                  <div
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs"
                    style={{
                      borderColor: `${selectedProps.accentColor}30`,
                      color: selectedProps.accentColor,
                      backgroundColor: `${selectedProps.accentColor}08`,
                    }}
                  >
                    {selectedZone.spaceType}
                  </div>
                </div>

                {/* Enable / Disable toggle */}
                <div className="mb-5">
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Zone Status
                  </label>
                  <button
                    type="button"
                    onClick={handleToggleEnabled}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs font-medium tracking-wider transition-all ${
                      (selectedProps.enabled ?? true)
                        ? 'border-emerald-500/30 bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25'
                        : 'border-zinc-600/40 bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700/40 hover:text-zinc-400'
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {(selectedProps.enabled ?? true) ? 'ENABLED' : 'DISABLED'}
                  </button>
                  <p className="mt-1.5 font-mono text-[9px] text-zinc-600">
                    Disabled zones are hidden from the 3D scene.
                  </p>
                </div>

                {/* Accent color picker */}
                <div className="mb-5">
                  <label className="mb-2 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Accent Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ACCENT_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => patchSelectedZone({ accentColor: color })}
                        className={`h-7 w-7 rounded-full border-2 transition-all ${
                          selectedProps.accentColor === color
                            ? 'scale-110 border-white shadow-lg'
                            : 'border-transparent hover:scale-105 hover:border-white/30'
                        }`}
                        style={{
                          backgroundColor: color,
                          boxShadow: selectedProps.accentColor === color ? `0 0 12px ${color}60` : undefined,
                        }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>

                {/* Workstation count */}
                <div className="mb-6">
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Workstation Count
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => patchSelectedZone({ workstationCount: Math.max(0, selectedProps.workstationCount - 1) })}
                      className="flex h-8 w-8 items-center justify-center rounded border border-white/[0.08] bg-white/[0.04] font-mono text-sm text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={selectedProps.workstationCount}
                      onChange={(e) => patchSelectedZone({ workstationCount: Math.max(0, Math.min(20, Number(e.target.value))) })}
                      className="h-8 w-16 rounded border border-white/[0.08] bg-white/[0.04] text-center font-mono text-sm text-zinc-200 outline-none focus:border-blue-500/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => patchSelectedZone({ workstationCount: Math.min(20, selectedProps.workstationCount + 1) })}
                      className="flex h-8 w-8 items-center justify-center rounded border border-white/[0.08] bg-white/[0.04] font-mono text-sm text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Apply Changes button */}
                <button
                  type="button"
                  onClick={handleApplyChanges}
                  className="w-full rounded-lg border border-blue-500/30 bg-blue-600/20 px-4 py-2.5 font-mono text-xs font-medium tracking-wider text-blue-300 transition-all hover:bg-blue-600/30 hover:text-blue-200 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                >
                  Apply Changes
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom Bar ──────────────────────────────────────────────── */}
      <div className="flex h-16 shrink-0 items-center justify-between border-t border-white/[0.06] px-8">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/70"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Default
        </button>
        <button
          type="button"
          onClick={() => { void handleSaveLayout(); }}
          disabled={saving}
          className="flex items-center gap-2.5 rounded-xl border border-blue-500/40 bg-blue-600/25 px-8 py-3 font-mono text-sm font-semibold tracking-wider text-blue-300 transition-all hover:bg-blue-600/40 hover:text-blue-200 hover:shadow-[0_0_30px_rgba(59,130,246,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving\u2026' : 'Save Layout'}
        </button>
      </div>
    </div>
  );
}
