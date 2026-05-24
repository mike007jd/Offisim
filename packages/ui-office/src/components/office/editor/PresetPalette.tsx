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
} from '@offisim/ui-core';
import { ChevronDown, Lock, Plus } from 'lucide-react';
import type { CSSProperties } from 'react';

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
    <div className="preset-palette">
      <div className="preset-palette-head">
        <p>ZONE_PRESETS</p>
      </div>
      <div className="preset-palette-scroll custom-scrollbar">
        {ZONE_PRESET_GROUPS.map((group) => {
          const isCollapsed = collapsed[group.archetype] ?? false;
          const required = isRequiredArchetype(group.archetype);
          return (
            <div key={group.archetype} className="preset-palette-group">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [group.archetype]: !p[group.archetype] }))
                }
                className="preset-palette-group-trigger"
                data-collapsed={isCollapsed ? 'true' : 'false'}
              >
                <ChevronDown data-icon="collapse" aria-hidden="true" />
                <span>{group.icon}</span>
                <span data-slot="label">{group.label}</span>
                {required && (
                  <Badge size="xs" variant="warning">
                    REQUIRED
                  </Badge>
                )}
                <span data-slot="count">{group.presets.length}</span>
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

        <div className="preset-palette-custom">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowCustomForm((v) => !v);
              setPlacingPreset(null);
            }}
            className="preset-palette-custom-trigger"
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            <span>Create Custom Zone</span>
          </Button>
          {showCustomForm && (
            <div className="preset-palette-custom-form">
              <Input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Zone name..."
                className="preset-palette-input"
              />
              <Select
                value={customArchetype}
                onValueChange={(value) => setCustomArchetype(value as ZoneArchetype)}
              >
                <SelectTrigger className="preset-palette-input">
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
                className="preset-palette-add"
              >
                Add to Canvas
              </Button>
            </div>
          )}
        </div>
      </div>

      {placingPreset && (
        <div className="preset-palette-status">
          <p>
            Placing: <strong>{placingPreset.label}</strong>
          </p>
          <p data-slot="hint">Click on canvas to place · ESC to cancel</p>
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
  const previewStyle = {
    '--preset-accent': preset.accentColor,
    '--preset-preview-width': `${Math.min((preset.w / 20) * 100, 100)}%`,
    '--preset-preview-depth': `${Math.min((preset.d / 12) * 100, 100)}%`,
  } as CSSProperties;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="preset-card"
      data-active={isActive ? 'true' : 'false'}
    >
      <div className="preset-card-preview-wrap">
        <div className="preset-card-preview" style={previewStyle}>
          <div />
        </div>
        {required && (
          <div className="preset-card-required">
            <Lock data-icon="required" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="preset-card-copy">
        <span>{preset.label}</span>
        <span data-slot="meta">
          {preset.w}x{preset.d} · {preset.prefabs.length} items
          {preset.deskSlots > 0 && ` · ${preset.deskSlots} desks`}
        </span>
      </div>
    </Button>
  );
}
