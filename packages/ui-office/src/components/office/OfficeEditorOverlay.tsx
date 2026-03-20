import { ArrowLeft, Eye, Grid3X3, RotateCcw, Save, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';
import { useAicsRuntime } from '../../runtime/aics-runtime-context.js';

// ── Props ───────────────────────────────────────────────────────────

export interface OfficeEditorOverlayProps {
  open: boolean;
  onClose: () => void;
}

// ── Zone data (matches departments.ts) ──────────────────────────────

interface ZoneData {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  readonly color: string;
  readonly row: number;
  readonly col: number;
  readonly colSpan?: number;
}

const ZONES: readonly ZoneData[] = [
  { id: 'dev', label: 'DEV', sublabel: '\u5F00\u53D1\u90E8\u95E8', color: '#3b82f6', row: 0, col: 0 },
  { id: 'product', label: 'PROD', sublabel: '\u4EA7\u54C1\u90E8\u95E8', color: '#a855f7', row: 0, col: 1 },
  { id: 'art', label: 'ART', sublabel: '\u7F8E\u672F\u90E8\u95E8', color: '#f97316', row: 0, col: 2 },
  { id: 'library', label: 'LIB', sublabel: '\u56FE\u4E66\u9986', color: '#10b981', row: 1, col: 0, colSpan: 1 },
  { id: 'rest', label: 'REST', sublabel: '\u4F11\u606F\u533A', color: '#f59e0b', row: 1, col: 1 },
  { id: 'meeting', label: 'MTG', sublabel: '\u4F1A\u8BAE\u5BA4', color: '#94a3b8', row: 2, col: 0 },
  { id: 'server', label: 'SRV', sublabel: '\u673A\u623F', color: '#06b6d4', row: 2, col: 1 },
];

// ── Accent color presets ────────────────────────────────────────────

const ACCENT_PRESETS = [
  '#3b82f6', '#a855f7', '#f97316', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#ec4899',
  '#94a3b8', '#84cc16',
] as const;

// ── View modes ──────────────────────────────────────────────────────

type ViewMode = '2d' | '3d';

// ── Zone properties state ───────────────────────────────────────────

interface ZoneProperties {
  accentColor: string;
  workstationCount: number;
}

// ── Component ───────────────────────────────────────────────────────

export function OfficeEditorOverlay({ open, onClose }: OfficeEditorOverlayProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [saving, setSaving] = useState(false);
  const { eventBus } = useAicsRuntime();
  const { activeLayout, createLayout, updateLayout } = useOfficeLayout();

  // Per-zone editable properties (keyed by zone id)
  const [zoneProps, setZoneProps] = useState<Record<string, ZoneProperties>>(() => {
    const initial: Record<string, ZoneProperties> = {};
    for (const zone of ZONES) {
      initial[zone.id] = { accentColor: zone.color, workstationCount: 4 };
    }
    return initial;
  });

  const selectedZone = ZONES.find((z) => z.id === selectedZoneId) ?? null;
  const selectedProps = selectedZoneId ? zoneProps[selectedZoneId] : null;

  // Show sidebar only in 2D mode when a zone is selected
  const showSidebar = viewMode === '2d' && selectedZone != null && selectedProps != null;

  const handleZoneClick = useCallback((zoneId: string) => {
    setSelectedZoneId((prev) => (prev === zoneId ? null : zoneId));
  }, []);

  const handleAccentColorChange = useCallback(
    (color: string) => {
      if (!selectedZoneId) return;
      setZoneProps((prev) => ({
        ...prev,
        [selectedZoneId]: { ...prev[selectedZoneId]!, accentColor: color },
      }));
    },
    [selectedZoneId],
  );

  const handleWorkstationCountChange = useCallback(
    (count: number) => {
      if (!selectedZoneId) return;
      setZoneProps((prev) => ({
        ...prev,
        [selectedZoneId]: { ...prev[selectedZoneId]!, workstationCount: Math.max(0, Math.min(20, count)) },
      }));
    },
    [selectedZoneId],
  );

  const handleResetDefaults = useCallback(() => {
    const initial: Record<string, ZoneProperties> = {};
    for (const zone of ZONES) {
      initial[zone.id] = { accentColor: zone.color, workstationCount: 4 };
    }
    setZoneProps(initial);
    setSelectedZoneId(null);
  }, []);

  const handleApplyChanges = useCallback(() => {
    if (!selectedZoneId || !selectedProps) return;
    // Emit a zone config change event so the scene can react immediately
    eventBus.emit({
      type: 'office.zone.config.changed',
      payload: { zoneId: selectedZoneId, accentColor: selectedProps.accentColor, workstationCount: selectedProps.workstationCount },
    });
  }, [selectedZoneId, selectedProps, eventBus]);

  const handleSaveLayout = useCallback(async () => {
    setSaving(true);
    try {
      const layoutJson = JSON.stringify(zoneProps);
      if (activeLayout) {
        await updateLayout(activeLayout.layout_id, { layout_json: layoutJson });
      } else {
        await createLayout('Default Layout', layoutJson);
      }
      eventBus.emit({ type: 'office.layout.saved', payload: { zoneProps } });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [zoneProps, activeLayout, updateLayout, createLayout, eventBus, onClose]);

  if (!open) return null;

  // ── Grid layout dimensions for the SVG map ────────────────────────
  const MAP_PADDING = 32;
  const ZONE_GAP = 12;
  const ROW_HEIGHTS = [200, 140, 120];
  const COL_COUNTS = [3, 2, 2];

  const svgWidth = 720;
  const svgHeight = MAP_PADDING * 2 + ROW_HEIGHTS.reduce((a, b) => a + b, 0) + ZONE_GAP * (ROW_HEIGHTS.length - 1);

  /** Compute zone rectangle geometry in SVG space */
  function getZoneRect(zone: ZoneData) {
    const contentWidth = svgWidth - MAP_PADDING * 2;
    const cols = COL_COUNTS[zone.row] ?? 3;
    const colWidth = (contentWidth - (cols - 1) * ZONE_GAP) / cols;
    const span = zone.colSpan ?? 1;

    const x = MAP_PADDING + zone.col * (colWidth + ZONE_GAP);
    let y = MAP_PADDING;
    for (let r = 0; r < zone.row; r++) {
      y += (ROW_HEIGHTS[r] ?? 0) + ZONE_GAP;
    }
    const width = colWidth * span + (span - 1) * ZONE_GAP;
    const height = ROW_HEIGHTS[zone.row] ?? 140;

    return { x, y, width, height };
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
          {/* View toggle */}
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
              {/* Background grid dots */}
              <defs>
                <pattern id="grid-dots" width="40" height="40" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.6" fill="rgba(255,255,255,0.04)" />
                </pattern>
                {/* Glow filter for selected zone */}
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

              {/* Zone rectangles */}
              {ZONES.map((zone) => {
                const { x, y, width, height } = getZoneRect(zone);
                const isSelected = selectedZoneId === zone.id;
                const accentColor = zoneProps[zone.id]?.accentColor ?? zone.color;

                return (
                  <g
                    key={zone.id}
                    onClick={() => handleZoneClick(zone.id)}
                    className="cursor-pointer"
                    filter={isSelected ? 'url(#zone-glow)' : undefined}
                  >
                    {/* Zone background */}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      rx={6}
                      fill={`${accentColor}10`}
                      stroke={isSelected ? '#3b82f6' : `${accentColor}40`}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />

                    {/* Accent top stripe */}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={4}
                      rx={6}
                      fill={accentColor}
                      opacity={isSelected ? 1 : 0.6}
                    />
                    {/* Re-square bottom corners of stripe */}
                    <rect
                      x={x}
                      y={y + 2}
                      width={width}
                      height={2}
                      fill={accentColor}
                      opacity={isSelected ? 1 : 0.6}
                    />

                    {/* Zone label */}
                    <text
                      x={x + width / 2}
                      y={y + height / 2 - 8}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={accentColor}
                      fontSize="18"
                      fontFamily="monospace"
                      fontWeight="700"
                      letterSpacing="0.15em"
                      opacity={isSelected ? 1 : 0.8}
                    >
                      {zone.label}
                    </text>

                    {/* Zone sublabel */}
                    <text
                      x={x + width / 2}
                      y={y + height / 2 + 14}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.35)"
                      fontSize="11"
                    >
                      {zone.sublabel}
                    </text>

                    {/* Workstation count badge */}
                    <text
                      x={x + width - 12}
                      y={y + height - 12}
                      textAnchor="end"
                      dominantBaseline="auto"
                      fill="rgba(255,255,255,0.2)"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {zoneProps[zone.id]?.workstationCount ?? 0} seats
                    </text>

                    {/* Selection indicator dots */}
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
            /* ── 3D Preview placeholder ──────────────────────────── */
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12">
                <Eye className="mx-auto mb-4 h-16 w-16 text-zinc-700" />
                <p className="font-mono text-sm font-semibold tracking-[0.2em] text-zinc-500">
                  3D_PREVIEW
                </p>
                <p className="mt-3 text-xs text-zinc-600">
                  3D \u5B9E\u65F6\u9884\u89C8\u5373\u5C06\u4E0A\u7EBF -- \u656C\u8BF7\u671F\u5F85
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Sidebar: Zone Properties (slides in when zone selected in 2D) ── */}
        <div
          className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${
            showSidebar ? 'w-80 opacity-100' : 'w-0 opacity-0 border-l-0'
          }`}
        >
          {showSidebar && selectedZone && selectedProps && (
            <>
              {/* Panel header */}
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
                {/* Zone name (read-only) */}
                <div className="mb-5">
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Zone Name
                  </label>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: selectedProps.accentColor }}
                    />
                    <span className="font-mono text-sm font-semibold tracking-wider text-zinc-200">
                      {selectedZone.label}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {selectedZone.sublabel}
                    </span>
                  </div>
                </div>

                {/* Zone type indicator */}
                <div className="mb-5">
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    Zone Type
                  </label>
                  <div
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs"
                    style={{
                      borderColor: `${selectedProps.accentColor}30`,
                      color: selectedProps.accentColor,
                      backgroundColor: `${selectedProps.accentColor}08`,
                    }}
                  >
                    {getZoneTypeLabel(selectedZone.id)}
                  </div>
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
                        onClick={() => handleAccentColorChange(color)}
                        className={`h-7 w-7 rounded-full border-2 transition-all ${
                          selectedProps.accentColor === color
                            ? 'scale-110 border-white shadow-lg'
                            : 'border-transparent hover:scale-105 hover:border-white/30'
                        }`}
                        style={{
                          backgroundColor: color,
                          boxShadow:
                            selectedProps.accentColor === color
                              ? `0 0 12px ${color}60`
                              : undefined,
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
                      onClick={() => handleWorkstationCountChange(selectedProps.workstationCount - 1)}
                      className="flex h-8 w-8 items-center justify-center rounded border border-white/[0.08] bg-white/[0.04] font-mono text-sm text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={selectedProps.workstationCount}
                      onChange={(e) => handleWorkstationCountChange(Number(e.target.value))}
                      className="h-8 w-16 rounded border border-white/[0.08] bg-white/[0.04] text-center font-mono text-sm text-zinc-200 outline-none focus:border-blue-500/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleWorkstationCountChange(selectedProps.workstationCount + 1)}
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
        {/* Reset to Default (ghost style) */}
        <button
          type="button"
          onClick={handleResetDefaults}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/70"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Default
        </button>

        {/* Save Layout (blue glow) */}
        <button
          type="button"
          onClick={() => { void handleSaveLayout(); }}
          disabled={saving}
          className="flex items-center gap-2.5 rounded-xl border border-blue-500/40 bg-blue-600/25 px-8 py-3 font-mono text-sm font-semibold tracking-wider text-blue-300 transition-all hover:bg-blue-600/40 hover:text-blue-200 hover:shadow-[0_0_30px_rgba(59,130,246,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Layout'}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function getZoneTypeLabel(zoneId: string): string {
  switch (zoneId) {
    case 'dev':
    case 'product':
    case 'art':
      return 'DEPARTMENT';
    case 'library':
      return 'LIBRARY';
    case 'rest':
      return 'REST_AREA';
    case 'meeting':
      return 'MEETING_ROOM';
    case 'server':
      return 'SERVER_ROOM';
    default:
      return 'UNKNOWN';
  }
}
