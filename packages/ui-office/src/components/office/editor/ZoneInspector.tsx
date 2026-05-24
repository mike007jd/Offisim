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
  cn,
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
  const inspectorLabelClass =
    'mb-sp-1 font-mono text-fs-micro uppercase tracking-ls-caps text-ink-3';

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-l border-line-soft bg-surface-1 transition-all duration-200',
        zone ? 'w-64 opacity-100' : 'w-0 border-l-0 opacity-0',
      )}
    >
      {zone && (
        <>
          <div className="flex items-center justify-between border-b border-line-soft px-sp-4 py-sp-3">
            <div className="flex items-center gap-sp-2">
              <h2 className="font-mono text-fs-micro font-bold uppercase tracking-ls-caps text-ink-2">
                ZONE
              </h2>
              {selectedZoneRequired && (
                <Badge
                  variant="warning"
                  size="xs"
                  className="gap-sp-1 rounded-r-xs px-sp-2 py-sp-1 font-bold"
                >
                  <Lock className="h-2 w-2" />
                  REQUIRED
                </Badge>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDeselect}
              className="h-7 w-7 text-ink-3 hover:text-ink-2"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-1 flex-col gap-sp-4 overflow-y-auto p-sp-4">
            <div>
              <p className={inspectorLabelClass}>Name</p>
              <Input
                type="text"
                value={zone.label}
                onChange={(e) => onLabelChange(e.target.value)}
                className="border-line-soft bg-surface-2 px-sp-2 py-sp-1 font-mono text-fs-micro"
              />
            </div>

            <div>
              <p className={inspectorLabelClass}>Type</p>
              <div className="flex items-center gap-sp-2">
                <span
                  className="h-3 w-3 rounded-sm"
                  // ui-hardcode-allowed: runtime zone accent swatch.
                  style={{ backgroundColor: zone.accentColor }}
                />
                <span className="font-mono text-fs-micro capitalize text-ink-2">
                  {zone.archetype ?? 'none'}
                </span>
              </div>
            </div>

            {variants.length > 1 && (
              <div>
                <p className={inspectorLabelClass}>Variant</p>
                <Select
                  value={zone.presetId ?? '__current'}
                  onValueChange={(value) => {
                    const p = variants.find((v) => v.id === value);
                    if (p) onSwapVariant(p);
                  }}
                >
                  <SelectTrigger className="h-8 border-line-soft bg-surface-2 px-sp-2 font-mono text-fs-micro text-ink-1">
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

            <div>
              <p className={inspectorLabelClass}>Size</p>
              <p className="font-mono text-fs-micro text-ink-2">
                {zone.w} x {zone.d} units
              </p>
            </div>

            <div>
              <p className="mb-sp-2 font-mono text-fs-micro uppercase tracking-ls-caps text-ink-3">
                Position
              </p>
              <div className="grid grid-cols-2 gap-sp-2">
                {(['X', 'Z'] as const).map((axis) => (
                  <div key={axis}>
                    <span className="font-mono text-fs-micro text-ink-3">{axis}</span>
                    <div className="mt-sp-1 flex items-center gap-sp-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onMoveZone(axis === 'X' ? -1 : 0, axis === 'Z' ? -1 : 0)}
                        className="h-6 w-6 text-ink-3 hover:text-ink-2"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </Button>
                      <span className="flex-1 text-center font-mono text-fs-micro text-ink-2">
                        {axis === 'X' ? zone.cx : zone.cz}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onMoveZone(axis === 'X' ? 1 : 0, axis === 'Z' ? 1 : 0)}
                        className="h-6 w-6 text-ink-3 hover:text-ink-2"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className={inspectorLabelClass}>Furniture</p>
              <p className="font-mono text-fs-micro text-ink-2">{itemCount} items</p>
              {zone.deskSlots > 0 && (
                <p className="mt-sp-1 font-mono text-fs-micro text-ink-3">
                  {zone.deskSlots} desk slots
                </p>
              )}
            </div>

            <Button
              type="button"
              variant={selectedZoneRequired ? 'secondary' : 'destructive'}
              onClick={onDeleteZone}
              disabled={selectedZoneRequired}
              className="w-full gap-sp-1 px-sp-3 py-sp-2 font-mono text-fs-micro"
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
            </Button>
          </div>

          <div className="border-t border-line-soft px-sp-4 py-sp-2">
            <p className="font-mono text-fs-micro text-ink-3">
              Drag to move · Del: Delete · Esc: Deselect
            </p>
          </div>
        </>
      )}
    </div>
  );
}
