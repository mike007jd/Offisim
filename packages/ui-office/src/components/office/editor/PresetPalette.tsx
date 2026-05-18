import type { ZoneArchetype, ZonePreset } from '@offisim/shared-types';
import { ZONE_PRESET_GROUPS, isRequiredArchetype } from '@offisim/shared-types';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@offisim/ui-core';
import { ChevronDown, Lock, Plus } from 'lucide-react';

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
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-surface">
      <div className="border-b border-border-subtle px-3 py-2.5">
        <p className="font-mono text-caption font-bold uppercase tracking-wider text-text-muted">
          ZONE_PRESETS
        </p>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {ZONE_PRESET_GROUPS.map((group) => {
          const isCollapsed = collapsed[group.archetype] ?? false;
          const required = isRequiredArchetype(group.archetype);
          return (
            <div key={group.archetype}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [group.archetype]: !p[group.archetype] }))
                }
                className="h-auto w-full justify-start rounded-none px-3 py-2 text-left font-mono text-caption font-semibold"
              >
                <ChevronDown
                  className={cn('size-3 transition-transform', isCollapsed && '-rotate-90')}
                  aria-hidden="true"
                />
                <span>{group.icon}</span>
                <span className="flex-1">{group.label}</span>
                {required && (
                  <Badge size="xs" variant="warning">
                    REQUIRED
                  </Badge>
                )}
                <span className="text-text-muted">{group.presets.length}</span>
              </Button>
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

        <div className="mt-1 border-t border-border-subtle pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowCustomForm((v) => !v);
              setPlacingPreset(null);
            }}
            className="h-auto w-full justify-start rounded-none px-3 py-2 text-left font-mono text-caption"
          >
            <Plus className="size-3" aria-hidden="true" />
            <span>Create Custom Zone</span>
          </Button>
          {showCustomForm && (
            <div className="flex flex-col gap-2 px-3 pb-2">
              <Input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Zone name..."
                className="h-8 font-mono text-caption"
              />
              <Select
                value={customArchetype}
                onValueChange={(value) => setCustomArchetype(value as ZoneArchetype)}
              >
                <SelectTrigger className="h-8 font-mono text-caption">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">Workspace</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="library">Library</SelectItem>
                  <SelectItem value="rest">Rest Area</SelectItem>
                  <SelectItem value="server">Server</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                onClick={onCreateCustom}
                className="w-full font-mono text-caption"
              >
                Add to Canvas
              </Button>
            </div>
          )}
        </div>
      </div>

      {placingPreset && (
        <div className="border-t border-border-subtle bg-accent-muted px-3 py-2">
          <p className="font-mono text-caption text-accent-text">
            Placing: <strong>{placingPreset.label}</strong>
          </p>
          <p className="mt-0.5 font-mono text-caption text-text-muted">
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
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'h-auto w-full justify-start rounded-none border-l-2 px-2 py-2 pl-6 text-left transition-all',
        isActive
          ? 'border-accent bg-accent-muted text-accent-text'
          : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary',
      )}
    >
      <div className="relative shrink-0">
        <div
          className="size-8 rounded"
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
          <div className="absolute -right-1 -top-1 flex size-3 items-center justify-center rounded-full bg-warning">
            <Lock className="size-1.5 text-text-inverse" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate font-mono text-caption font-medium">{preset.label}</span>
        <span className="block font-mono text-caption text-text-muted">
          {preset.w}x{preset.d} · {preset.prefabs.length} items
          {preset.deskSlots > 0 && ` · ${preset.deskSlots} desks`}
        </span>
      </div>
    </Button>
  );
}
