import type { ZoneArchetype, ZonePreset } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import { Lock, Plus } from 'lucide-react';

export interface PresetPaletteProps {
  collapsed: Record<string, boolean>;
  placingPreset: ZonePreset | null;
  showCustomForm: boolean;
  customLabel: string;
  customArchetype: ZoneArchetype;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setShowCustomForm: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomLabel: React.Dispatch<React.SetStateAction<string>>;
  setCustomArchetype: React.Dispatch<React.SetStateAction<ZoneArchetype>>;
  setPlacingPreset: React.Dispatch<React.SetStateAction<ZonePreset | null>>;
  onPresetClick: (preset: ZonePreset) => void;
  onCreateCustom: () => void;
}

export function PresetPalette({
  collapsed,
  placingPreset,
  showCustomForm,
  customLabel,
  customArchetype,
  setCollapsed,
  setShowCustomForm,
  setCustomLabel,
  setCustomArchetype,
  setPlacingPreset,
  onPresetClick,
  onCreateCustom,
}: PresetPaletteProps) {
  return (
    <div className="w-60 shrink-0 border-r border-white/[0.06] bg-[#060a14] flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/[0.06]">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          ZONE_PRESETS
        </p>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {ZONE_PRESET_GROUPS.map((group) => {
          const isCollapsed = collapsed[group.archetype] ?? false;
          const required = isRequiredArchetype(group.archetype);
          return (
            <div key={group.archetype}>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [group.archetype]: !p[group.archetype] }))
                }
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-mono text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.03] transition-colors"
              >
                <span
                  className="text-[8px] transition-transform"
                  style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}
                >
                  ▼
                </span>
                <span>{group.icon}</span>
                <span className="flex-1">{group.label}</span>
                {required && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[7px] font-bold text-amber-400 tracking-wider">
                    REQUIRED
                  </span>
                )}
                <span className="text-zinc-600">{group.presets.length}</span>
              </button>
              {!isCollapsed &&
                group.presets.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    isActive={placingPreset?.id === preset.id}
                    onClick={() => onPresetClick(preset)}
                  />
                ))}
            </div>
          );
        })}

        <div className="border-t border-white/[0.06] mt-1 pt-1">
          <button
            type="button"
            onClick={() => {
              setShowCustomForm((v) => !v);
              setPlacingPreset(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Create Custom Zone</span>
          </button>
          {showCustomForm && (
            <div className="px-3 pb-2 space-y-2">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Zone name..."
                className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
              />
              <select
                value={customArchetype}
                onChange={(e) => setCustomArchetype(e.target.value as ZoneArchetype)}
                className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-zinc-200 outline-none focus:border-blue-500/50"
              >
                <option value="workspace">Workspace</option>
                <option value="meeting">Meeting</option>
                <option value="library">Library</option>
                <option value="rest">Rest Area</option>
                <option value="server">Server</option>
              </select>
              <button
                type="button"
                onClick={onCreateCustom}
                className="w-full rounded border border-blue-500/30 bg-blue-600/15 py-1.5 font-mono text-[10px] text-blue-300 hover:bg-blue-600/25 transition-colors"
              >
                Add to Canvas
              </button>
            </div>
          )}
        </div>
      </div>

      {placingPreset && (
        <div className="border-t border-white/[0.06] px-3 py-2 bg-blue-500/5">
          <p className="font-mono text-[10px] text-blue-400">
            Placing: <strong>{placingPreset.label}</strong>
          </p>
          <p className="font-mono text-[8px] text-zinc-600 mt-0.5">
            Click on canvas to place · ESC to cancel
          </p>
        </div>
      )}
    </div>
  );
}

interface PresetCardProps {
  preset: ZonePreset;
  isActive: boolean;
  onClick: () => void;
}

function PresetCard({ preset, isActive, onClick }: PresetCardProps) {
  const required = isRequiredArchetype(preset.archetype);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-2 py-2 pl-6 text-left transition-all ${
        isActive
          ? 'bg-blue-500/15 text-blue-300 border-l-2 border-blue-500'
          : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border-l-2 border-transparent'
      }`}
    >
      <div className="relative shrink-0">
        <div
          className="h-8 w-8 rounded"
          style={{
            backgroundColor: `${preset.accentColor}20`,
            border: `1.5px solid ${preset.accentColor}40`,
          }}
        >
          <div
            className="absolute rounded-sm"
            style={{
              backgroundColor: `${preset.accentColor}50`,
              width: `${Math.min((preset.w / 20) * 100, 100)}%`,
              height: `${Math.min((preset.d / 12) * 100, 100)}%`,
              left: '50%',
              top: '50%',
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
