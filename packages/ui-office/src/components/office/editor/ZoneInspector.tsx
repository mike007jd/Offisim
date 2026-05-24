import type { ZonePreset } from '@offisim/shared-types';
import { getPresetsForArchetype } from '@offisim/shared-types';
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
    <div className="zone-inspector" data-open={zone ? 'true' : 'false'}>
      {zone && (
        <>
          <div className="zone-inspector-header">
            <div className="zone-inspector-title">
              <h2>ZONE</h2>
              {selectedZoneRequired && (
                <Badge variant="warning" size="xs" className="zone-inspector-required">
                  <Lock data-icon="inline-start" aria-hidden="true" />
                  REQUIRED
                </Badge>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDeselect}
              className="zone-inspector-close"
            >
              <X data-icon="button" aria-hidden="true" />
            </Button>
          </div>
          <div className="zone-inspector-body">
            <div className="zone-inspector-field">
              <p data-slot="label">Name</p>
              <Input
                type="text"
                value={zone.label}
                onChange={(e) => onLabelChange(e.target.value)}
                className="zone-inspector-input"
              />
            </div>

            <div className="zone-inspector-field">
              <p data-slot="label">Type</p>
              <div className="zone-inspector-row">
                <span
                  data-swatch="zone"
                  // ui-hardcode-allowed: runtime zone accent swatch.
                  style={{ backgroundColor: zone.accentColor }}
                />
                <span data-slot="value" data-transform="capitalize">
                  {zone.archetype ?? 'none'}
                </span>
              </div>
            </div>

            {variants.length > 1 && (
              <div className="zone-inspector-field">
                <p data-slot="label">Variant</p>
                <Select
                  value={zone.presetId ?? '__current'}
                  onValueChange={(value) => {
                    const p = variants.find((v) => v.id === value);
                    if (p) onSwapVariant(p);
                  }}
                >
                  <SelectTrigger className="zone-inspector-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!zone.presetId && <SelectItem value="__current">Current</SelectItem>}
                    {variants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label} ({v.w}x{v.d})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="zone-inspector-field">
              <p data-slot="label">Size</p>
              <p data-slot="value">
                {zone.w} x {zone.d} units
              </p>
            </div>

            <div className="zone-inspector-field">
              <p data-slot="label">Position</p>
              <div className="zone-inspector-position-grid">
                {(['X', 'Z'] as const).map((axis) => (
                  <div key={axis} className="zone-inspector-axis">
                    <span>{axis}</span>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onMoveZone(axis === 'X' ? -1 : 0, axis === 'Z' ? -1 : 0)}
                        className="zone-inspector-stepper"
                      >
                        <Minus data-icon="button" aria-hidden="true" />
                      </Button>
                      <span data-slot="axis-value">{axis === 'X' ? zone.cx : zone.cz}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onMoveZone(axis === 'X' ? 1 : 0, axis === 'Z' ? 1 : 0)}
                        className="zone-inspector-stepper"
                      >
                        <Plus data-icon="button" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="zone-inspector-field">
              <p data-slot="label">Furniture</p>
              <p data-slot="value">{itemCount} items</p>
              {zone.deskSlots > 0 && <p data-slot="muted">{zone.deskSlots} desk slots</p>}
            </div>

            <Button
              type="button"
              variant={selectedZoneRequired ? 'secondary' : 'destructive'}
              onClick={onDeleteZone}
              disabled={selectedZoneRequired}
              className="zone-inspector-delete"
            >
              {selectedZoneRequired ? (
                <>
                  <Lock data-icon="inline-start" aria-hidden="true" />
                  Required — Cannot Delete
                </>
              ) : (
                <>
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  Delete Zone
                </>
              )}
            </Button>
          </div>

          <div className="zone-inspector-footer">
            <p>Drag to move · Del: Delete · Esc: Deselect</p>
          </div>
        </>
      )}
    </div>
  );
}
