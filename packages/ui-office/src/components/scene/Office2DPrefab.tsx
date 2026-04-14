/** @deprecated Pending removal. Canvas renderer uses office-2d-render-registry.ts instead. */
/**
 * Office2DPrefab — Data-driven SVG renderer for prefab instances in the 2D office view.
 *
 * Maps prefab category/ID to SVG components. Uses the same data source as Office3DView
 * (usePrefabInstances) to ensure 2D/3D consistency.
 */

import { memo } from 'react';

// ── SVG Furniture Primitives ────────────────────────────────────────

function WorkstationSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-22"
        y="-18"
        width="44"
        height="36"
        rx="2"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <rect x="-18" y="-14" width="36" height="28" rx="1" fill="var(--surface-light)" />
      <line x1="0" y1="-18" x2="0" y2="18" stroke="var(--surface-mid)" strokeWidth="0.5" />
      <line x1="-22" y1="0" x2="22" y2="0" stroke="var(--surface-mid)" strokeWidth="0.5" />
      {[
        [-10, -8],
        [10, -8],
        [-10, 8],
        [10, 8],
      ].map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="3"
          fill="var(--surface-mid)"
          stroke="var(--surface-lighter)"
          strokeWidth="0.5"
        />
      ))}
    </g>
  );
}

function ServerRackSVG({ x, y }: { x: number; y: number }) {
  const rows = [-40, -29, -18, -7, 4, 15, 26, 37] as const;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-18"
        y="-45"
        width="36"
        height="90"
        rx="3"
        fill="var(--surface-light)"
        stroke="var(--surface-lighter)"
        strokeWidth="1.5"
      />
      {rows.map((row, i) => (
        <g key={row}>
          <rect x="-14" y={row} width="28" height="9" rx="1" fill="var(--surface)" />
          <circle cx="10" cy={row + 4} r="2" fill={i % 3 === 0 ? '#fbbf24' : '#22c55e'} />
        </g>
      ))}
    </g>
  );
}

function BookshelfSVG({ x, y }: { x: number; y: number }) {
  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-25"
        y="-35"
        width="50"
        height="70"
        rx="3"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      {[0, 1, 2, 3].map((shelf) => (
        <g key={shelf}>
          <rect x="-23" y={-30 + shelf * 17} width="46" height="1" fill="var(--surface-mid)" />
          {[0, 1, 2, 3, 4, 5, 6].map((b) => (
            <rect
              key={b}
              x={-21 + b * 6.5}
              y={-28 + shelf * 17}
              width="5"
              height="14"
              rx="0.5"
              fill={colors[(shelf * 7 + b) % colors.length]}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

function MeetingTableSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-100"
        y="-35"
        width="200"
        height="70"
        rx="20"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="2"
      />
      <rect x="-85" y="-25" width="170" height="50" rx="12" fill="var(--surface-light)" />
      {[-60, -20, 20, 60].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-55}
            r="12"
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth="1"
          />
          <circle
            cx={cx}
            cy={55}
            r="12"
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth="1"
          />
        </g>
      ))}
    </g>
  );
}

function SofaSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M-50,-20 L50,-20 L50,10 L30,10 L30,-5 L-30,-5 L-30,10 L-50,10 Z" fill="#f59e0b" />
      <rect x="-55" y="-20" width="10" height="30" rx="4" fill="var(--surface-light)" />
      <rect x="45" y="-20" width="10" height="30" rx="4" fill="var(--surface-light)" />
    </g>
  );
}

/** Exported for reuse by Office2DView corner decorations. */
export function PlantSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="5"
        r="12"
        fill="var(--surface-mid)"
        stroke="var(--text-muted-val)"
        strokeWidth="1"
      />
      {[0, 72, 144, 216, 288].map((angle) => (
        <path
          key={angle}
          d="M0,0 C-12,-18 12,-18 0,0"
          fill="#10b981"
          transform={`rotate(${angle})`}
        />
      ))}
    </g>
  );
}

function CoffeeTableSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="0"
        r="25"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <circle cx="0" cy="0" r="12" fill="var(--surface-light)" />
    </g>
  );
}

function VendingMachineSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-16"
        y="-30"
        width="32"
        height="60"
        rx="4"
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <rect x="-12" y="-26" width="24" height="25" rx="2" fill="#0ea5e9" opacity="0.5" />
      <rect x="-10" y="5" width="20" height="8" rx="2" fill="var(--surface-light)" />
    </g>
  );
}

function WhiteboardSVG({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-30"
        y="-20"
        width="60"
        height="40"
        rx="2"
        fill="#f1f5f9"
        stroke="var(--surface-mid)"
        strokeWidth="1"
      />
      <line x1="-25" y1="-10" x2="10" y2="-10" stroke="#94a3b8" strokeWidth="1" />
      <line x1="-25" y1="0" x2="20" y2="0" stroke="#94a3b8" strokeWidth="1" />
      <line x1="-25" y1="10" x2="5" y2="10" stroke="#94a3b8" strokeWidth="1" />
    </g>
  );
}

function GenericPrefabSVG({
  x,
  y,
  label,
  color,
}: { x: number; y: number; label: string; color: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x="-15"
        y="-15"
        width="30"
        height="30"
        rx="3"
        fill={color}
        fillOpacity={0.15}
        stroke={color}
        strokeWidth="1"
        strokeOpacity={0.4}
      />
      <text
        x="0"
        y="3"
        textAnchor="middle"
        fontSize="7"
        fill={color}
        fontWeight="600"
        fontFamily="system-ui"
      >
        {label.slice(0, 3)}
      </text>
    </g>
  );
}

// ── Lookup tables (declared before component) ───────────────────────

type SvgFC = React.FC<{ x: number; y: number }>;

const SVG_COMPONENTS: Record<string, SvgFC> = {
  workstation: WorkstationSVG,
  'server-rack': ServerRackSVG,
  bookshelf: BookshelfSVG,
  'meeting-table': MeetingTableSVG,
  sofa: SofaSVG,
  plant: PlantSVG,
  'coffee-table': CoffeeTableSVG,
  'vending-machine': VendingMachineSVG,
  whiteboard: WhiteboardSVG,
};

const PREFAB_SVG_MAP: Record<string, string> = {
  'workstation-standard': 'workstation',
  'workstation-compact': 'workstation',
  'workstation-dual': 'workstation',
  'server-rack-2u': 'server-rack',
  'server-rack-4u': 'server-rack',
  'gpu-cluster': 'server-rack',
  'bookshelf-single': 'bookshelf',
  'bookshelf-double': 'bookshelf',
  'filing-cabinet': 'generic',
  whiteboard: 'whiteboard',
  'meeting-table-4': 'meeting-table',
  'meeting-table-8': 'meeting-table',
  'sofa-set': 'sofa',
  'standing-table': 'coffee-table',
  'network-switch': 'generic',
  'cable-tray': 'generic',
  'patch-panel': 'generic',
  'plant-small': 'plant',
  'plant-large': 'plant',
  'coffee-table': 'coffee-table',
  'vending-machine': 'vending-machine',
  'water-cooler': 'vending-machine',
  'reading-table': 'workstation',
  'chair-standalone': 'generic',
  'status-board': 'whiteboard',
};

const CATEGORY_SVG: Record<string, string> = {
  workspace: 'workstation',
  compute: 'server-rack',
  knowledge: 'bookshelf',
  meeting: 'meeting-table',
  rest: 'sofa',
  decorative: 'plant',
  infrastructure: 'server-rack',
};

const CATEGORY_COLORS: Record<string, string> = {
  workspace: '#3b82f6',
  compute: '#06b6d4',
  knowledge: '#10b981',
  meeting: '#94a3b8',
  rest: '#f59e0b',
  decorative: '#10b981',
  infrastructure: '#06b6d4',
};

// ── Main component ──────────────────────────────────────────────────

export interface Office2DPrefabProps {
  prefabId: string;
  category: string;
  x: number;
  y: number;
  rotation: number;
}

export const Office2DPrefab = memo(function Office2DPrefab({
  prefabId,
  category,
  x,
  y,
  rotation,
}: Office2DPrefabProps) {
  const resolvedType = PREFAB_SVG_MAP[prefabId] ?? CATEGORY_SVG[category] ?? 'generic';
  const Svg = SVG_COMPONENTS[resolvedType];

  return (
    <g transform={`rotate(${rotation}, ${x}, ${y})`}>
      {Svg ? (
        <Svg x={x} y={y} />
      ) : (
        <GenericPrefabSVG
          x={x}
          y={y}
          label={prefabId}
          color={CATEGORY_COLORS[category] ?? '#64748b'}
        />
      )}
    </g>
  );
});
