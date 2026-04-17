import type { ZonePreset } from '@offisim/shared-types';
import { getPresetsForArchetype } from '@offisim/shared-types';
import { Lock, Minus, Plus, Trash2, X } from 'lucide-react';
import type { EditorZone } from './types.js';

export interface ZoneInspectorProps {
  zone: EditorZone | null;
  selectedZoneRequired: boolean;
  itemCount: number;
  onLabelChange: (label: string) => void;
  onMoveZone: (dx: number, dz: number) => void;
  onSwapVariant: (preset: ZonePreset) => void;
  onDeleteZone: () => void;
  onDeselect: () => void;
}

export function ZoneInspector({
  zone,
  selectedZoneRequired,
  itemCount,
  onLabelChange,
  onMoveZone,
  onSwapVariant,
  onDeleteZone,
  onDeselect,
}: ZoneInspectorProps) {
  const variants = zone?.archetype ? getPresetsForArchetype(zone.archetype) : [];

  return (
    <div
      className={`shrink-0 border-l border-white/[0.06] bg-[#060a14] flex flex-col transition-all duration-200 overflow-hidden ${zone ? 'w-64 opacity-100' : 'w-0 opacity-0 border-l-0'}`}
    >
      {zone && (
        <>
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
                ZONE
              </h2>
              {selectedZoneRequired && (
                <span className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[7px] font-bold text-amber-400">
                  <Lock className="h-2 w-2" />
                  REQUIRED
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onDeselect}
              className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                Name
              </p>
              <input
                type="text"
                value={zone.label}
                onChange={(e) => onLabelChange(e.target.value)}
                className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500/50"
              />
            </div>

            <div>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                Type
              </p>
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: zone.accentColor }}
                />
                <span className="font-mono text-xs text-zinc-300 capitalize">
                  {zone.archetype ?? 'none'}
                </span>
              </div>
            </div>

            {variants.length > 1 && (
              <div>
                <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                  Variant
                </p>
                <select
                  value={zone.presetId ?? ''}
                  onChange={(e) => {
                    const p = variants.find((v) => v.id === e.target.value);
                    if (p) onSwapVariant(p);
                  }}
                  className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
                >
                  {!zone.presetId && <option value="">Current</option>}
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} ({v.w}x{v.d})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                Size
              </p>
              <p className="font-mono text-xs text-zinc-300">
                {zone.w} x {zone.d} units
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-2">
                Position
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(['X', 'Z'] as const).map((axis) => (
                  <div key={axis}>
                    <span className="font-mono text-[8px] text-zinc-600">{axis}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <button
                        type="button"
                        onClick={() => onMoveZone(axis === 'X' ? -1 : 0, axis === 'Z' ? -1 : 0)}
                        className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="flex-1 text-center font-mono text-[10px] text-zinc-300">
                        {axis === 'X' ? zone.cx : zone.cz}
                      </span>
                      <button
                        type="button"
                        onClick={() => onMoveZone(axis === 'X' ? 1 : 0, axis === 'Z' ? 1 : 0)}
                        className="rounded bg-white/[0.06] p-1 text-zinc-500 hover:bg-white/[0.1] hover:text-zinc-300"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider mb-1">
                Furniture
              </p>
              <p className="font-mono text-xs text-zinc-300">{itemCount} items</p>
              {zone.deskSlots > 0 && (
                <p className="font-mono text-[10px] text-zinc-500 mt-0.5">
                  {zone.deskSlots} desk slots
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={onDeleteZone}
              disabled={selectedZoneRequired}
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-[10px] transition-colors ${
                selectedZoneRequired
                  ? 'border-zinc-700 bg-zinc-800/30 text-zinc-600 cursor-not-allowed'
                  : 'border-red-500/30 bg-red-600/10 text-red-400 hover:bg-red-600/20'
              }`}
            >
              {selectedZoneRequired ? (
                <>
                  <Lock className="h-3 w-3" />
                  Required — Cannot Delete
                </>
              ) : (
                <>
                  <Trash2 className="h-3 w-3" />
                  Delete Zone
                </>
              )}
            </button>
          </div>

          <div className="border-t border-white/[0.06] px-4 py-2">
            <p className="font-mono text-[8px] text-zinc-700">
              Drag to move · Del: Delete · Esc: Deselect
            </p>
          </div>
        </>
      )}
    </div>
  );
}
