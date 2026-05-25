import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Armchair, Box, LayoutDashboard, Move3d, PanelTop, Sofa } from 'lucide-react';
import { useState } from 'react';

const TOOLS = [
  { id: 'desk', label: 'Desk cluster', icon: PanelTop },
  { id: 'seat', label: 'Seating', icon: Armchair },
  { id: 'lounge', label: 'Lounge', icon: Sofa },
  { id: 'prop', label: 'Props', icon: Box },
];

export function StudioSurface() {
  const [tool, setTool] = useState<'select' | 'place'>('select');

  return (
    <div className="off-studio">
      <aside className="off-studio-panel is-left">
        <div className="off-studio-panel-head">
          <CapsLabel>Objects</CapsLabel>
        </div>
        <div className="off-studio-panel-body">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className="off-studio-tool off-focusable">
              <Icon icon={t.icon} size="sm" />
              {t.label}
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
            onChange={setTool}
            ariaLabel="Studio tool"
          />
          <span className="ml-auto">
            <Button size="md" variant="subtle">
              Open layout
            </Button>
          </span>
        </div>
        <EmptyState
          icon={LayoutDashboard}
          title="No layout open"
          description="Open an office layout to arrange desks, seating, and props on the floor."
          action={{ label: 'Open layout', onClick: () => {} }}
        />
      </section>

      <aside className="off-studio-panel is-right">
        <div className="off-studio-panel-head">
          <CapsLabel>Properties</CapsLabel>
        </div>
        <div className="off-studio-panel-body">
          <EmptyState
            icon={Move3d}
            title="No selection"
            description="Select an object on the floor to edit its properties."
          />
        </div>
      </aside>
    </div>
  );
}
