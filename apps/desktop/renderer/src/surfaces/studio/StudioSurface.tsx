import { useOfficeScene } from '@/data/queries.js';
import type { OfficeZone } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { OfficeScene3D } from '@/surfaces/office/scene/OfficeScene3D.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Armchair, Box, LayoutGrid, Move3d, PanelTop, Sofa, Sprout } from 'lucide-react';
import { useState } from 'react';

const PALETTE = [
  { id: 'desk', label: 'Desk cluster', icon: PanelTop },
  { id: 'seating', label: 'Seating', icon: Armchair },
  { id: 'lounge', label: 'Lounge', icon: Sofa },
  { id: 'plant', label: 'Plant', icon: Sprout },
  { id: 'prop', label: 'Props', icon: Box },
];

const ZONE_KIND_LABEL: Record<OfficeZone['kind'], string> = {
  workspace: 'Workspace',
  meeting: 'Meeting',
  lounge: 'Lounge',
};

export function StudioSurface() {
  const scene = useOfficeScene();
  const [tool, setTool] = useState<'select' | 'place'>('select');
  const [placing, setPlacing] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const zones = scene.data?.zones ?? [];
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  return (
    <div className="off-studio">
      <aside className="off-studio-panel is-left">
        <div className="off-studio-panel-head">
          <CapsLabel>Objects</CapsLabel>
        </div>
        <div className="off-studio-panel-body">
          {PALETTE.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn('off-studio-tool off-focusable', placing === item.id && 'is-on')}
              onClick={() => {
                setTool('place');
                setPlacing(item.id);
              }}
            >
              <Icon icon={item.icon} size="sm" />
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="off-studio-stage">
        <div className="off-studio-toolbar">
          <SegmentedControl
            options={[
              { value: 'select', label: 'Select', icon: <Icon icon={Move3d} size="sm" /> },
              { value: 'place', label: 'Place', icon: <Icon icon={Box} size="sm" /> },
            ]}
            value={tool}
            onChange={(v) => {
              setTool(v);
              if (v === 'select') setPlacing(null);
            }}
            ariaLabel="Studio tool"
          />
          <span className="off-studio-toolbar-hint">
            {tool === 'place' && placing
              ? `Placing: ${PALETTE.find((p) => p.id === placing)?.label}`
              : 'Orbit · scroll to zoom'}
          </span>
        </div>
        <div className="off-studio-canvas-host">
          <OfficeScene3D />
        </div>
      </section>

      <aside className="off-studio-panel is-right">
        <div className="off-studio-panel-head">
          <CapsLabel>Zones</CapsLabel>
        </div>
        <div className="off-studio-panel-body">
          {zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className={cn(
                'off-studio-zone off-focusable',
                zone.id === selectedZoneId && 'is-sel',
              )}
              onClick={() => setSelectedZoneId(zone.id)}
            >
              <Icon icon={LayoutGrid} size="sm" />
              <span className="off-studio-zone-name">{zone.label}</span>
              <span className="off-studio-zone-kind">{ZONE_KIND_LABEL[zone.kind]}</span>
            </button>
          ))}
        </div>
        {selectedZone ? (
          <div className="off-studio-props">
            <CapsLabel>Properties</CapsLabel>
            <div className="off-about-row">
              <span>Label</span>
              <span>{selectedZone.label}</span>
            </div>
            <div className="off-about-row">
              <span>Kind</span>
              <span>{ZONE_KIND_LABEL[selectedZone.kind]}</span>
            </div>
            <div className="off-about-row">
              <span>Footprint</span>
              <span>
                {selectedZone.w} × {selectedZone.d}
              </span>
            </div>
          </div>
        ) : (
          <div className="off-studio-props">
            <EmptyState
              icon={Move3d}
              title="No selection"
              description="Pick a zone to edit it, or place an object from the palette."
            />
          </div>
        )}
      </aside>
    </div>
  );
}
