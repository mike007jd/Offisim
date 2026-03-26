/**
 * PrefabThumbnail — SVG top-down plan view thumbnails for each prefab type.
 *
 * Lightweight, vector-based, no 3D rendering overhead.
 * Each prefab gets a unique simplified floor-plan icon.
 */

import { STUDIO_COLORS } from './studio-tokens.js';

interface PrefabThumbnailProps {
  prefabId: string;
  size?: number;
  color?: string;
}

export function PrefabThumbnail({ prefabId, size = 36, color }: PrefabThumbnailProps) {
  const c = color ?? STUDIO_COLORS.textSecondary;
  const render: SvgRenderer = THUMBNAILS[prefabId] ?? DEFAULT_THUMBNAIL;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{prefabId}</title>
      {render(c)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG renderers per prefab — simplified top-down plan views
// ---------------------------------------------------------------------------

type SvgRenderer = (c: string) => React.ReactNode;

const DEFAULT_THUMBNAIL: SvgRenderer = (c) => (
  <>
    <rect
      x="8"
      y="8"
      width="16"
      height="16"
      rx="2"
      stroke={c}
      strokeWidth="1.5"
      fill="none"
      strokeDasharray="3 2"
    />
    <circle cx="16" cy="16" r="3" stroke={c} strokeWidth="1" fill="none" opacity="0.5" />
  </>
);

const THUMBNAILS: Record<string, SvgRenderer> = {
  // ── Workspace ──
  'workstation-standard': (c) => (
    <>
      {/* Desk surface */}
      <rect x="6" y="8" width="20" height="16" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* 4 chairs */}
      <circle cx="11" cy="6" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="21" cy="6" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="11" cy="26" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="21" cy="26" r="2" stroke={c} strokeWidth="1" fill="none" />
      {/* Monitor lines */}
      <line x1="10" y1="13" x2="15" y2="13" stroke={c} strokeWidth="1" opacity="0.5" />
      <line x1="17" y1="19" x2="22" y2="19" stroke={c} strokeWidth="1" opacity="0.5" />
    </>
  ),

  'workstation-compact': (c) => (
    <>
      <rect x="8" y="10" width="16" height="12" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      <circle cx="12" cy="7" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="20" cy="25" r="2" stroke={c} strokeWidth="1" fill="none" />
      <line x1="11" y1="15" x2="16" y2="15" stroke={c} strokeWidth="1" opacity="0.5" />
    </>
  ),

  'workstation-dual': (c) => (
    <>
      <rect x="5" y="8" width="22" height="16" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      <circle cx="10" cy="6" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="22" cy="6" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="10" cy="26" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="22" cy="26" r="2" stroke={c} strokeWidth="1" fill="none" />
      {/* Dual monitors */}
      <rect
        x="9"
        y="12"
        width="6"
        height="3"
        rx="0.5"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
      <rect
        x="17"
        y="12"
        width="6"
        height="3"
        rx="0.5"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
    </>
  ),

  // ── Compute ──
  'server-rack-2u': (c) => (
    <>
      <rect x="8" y="4" width="16" height="24" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Rack units */}
      {[8, 12, 16, 20].map((y) => (
        <line key={y} x1="10" y1={y} x2="22" y2={y} stroke={c} strokeWidth="0.8" opacity="0.4" />
      ))}
      {/* LEDs */}
      <circle cx="12" cy="10" r="1" fill={c} opacity="0.6" />
      <circle cx="12" cy="14" r="1" fill={c} opacity="0.6" />
    </>
  ),

  'server-rack-4u': (c) => (
    <>
      <rect x="6" y="4" width="20" height="24" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {[8, 11, 14, 17, 20, 23].map((y) => (
        <line key={y} x1="8" y1={y} x2="24" y2={y} stroke={c} strokeWidth="0.8" opacity="0.4" />
      ))}
      <circle cx="10" cy="9.5" r="1" fill={c} opacity="0.6" />
      <circle cx="10" cy="12.5" r="1" fill={c} opacity="0.6" />
      <circle cx="10" cy="15.5" r="1" fill={c} opacity="0.6" />
    </>
  ),

  'gpu-cluster': (c) => (
    <>
      <rect x="5" y="6" width="22" height="20" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* GPU cards */}
      <rect
        x="8"
        y="9"
        width="16"
        height="4"
        rx="1"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
      <rect
        x="8"
        y="15"
        width="16"
        height="4"
        rx="1"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
      <rect
        x="8"
        y="21"
        width="16"
        height="3"
        rx="1"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
    </>
  ),

  // ── Knowledge ──
  'bookshelf-single': (c) => (
    <>
      <rect x="7" y="5" width="18" height="22" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Shelves + books */}
      {[10, 15, 20].map((y) => (
        <g key={y}>
          <line x1="8" y1={y} x2="24" y2={y} stroke={c} strokeWidth="0.8" opacity="0.3" />
          <rect x="10" y={y - 3} width="2" height="3" fill={c} opacity="0.3" />
          <rect x="13" y={y - 4} width="2" height="4" fill={c} opacity="0.2" />
          <rect x="16" y={y - 3} width="2" height="3" fill={c} opacity="0.4" />
        </g>
      ))}
    </>
  ),

  'bookshelf-double': (c) => (
    <>
      <rect x="4" y="5" width="24" height="22" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      <line x1="16" y1="6" x2="16" y2="26" stroke={c} strokeWidth="0.8" opacity="0.3" />
      {[10, 15, 20].map((y) => (
        <g key={y}>
          <line x1="5" y1={y} x2="27" y2={y} stroke={c} strokeWidth="0.8" opacity="0.3" />
          <rect x="7" y={y - 3} width="2" height="3" fill={c} opacity="0.3" />
          <rect x="19" y={y - 3} width="2" height="3" fill={c} opacity="0.3" />
        </g>
      ))}
    </>
  ),

  'filing-cabinet': (c) => (
    <>
      <rect x="9" y="5" width="14" height="22" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Drawers */}
      {[10, 15, 20].map((y) => (
        <g key={y}>
          <line x1="10" y1={y} x2="22" y2={y} stroke={c} strokeWidth="0.8" opacity="0.4" />
          <circle cx="16" cy={y - 2} r="0.8" fill={c} opacity="0.5" />
        </g>
      ))}
    </>
  ),

  whiteboard: (c) => (
    <>
      <rect x="5" y="7" width="22" height="15" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Stand legs */}
      <line x1="8" y1="22" x2="8" y2="27" stroke={c} strokeWidth="1.2" />
      <line x1="24" y1="22" x2="24" y2="27" stroke={c} strokeWidth="1.2" />
      {/* Content lines */}
      <line x1="8" y1="11" x2="18" y2="11" stroke={c} strokeWidth="0.8" opacity="0.3" />
      <line x1="8" y1="14" x2="22" y2="14" stroke={c} strokeWidth="0.8" opacity="0.3" />
      <line x1="8" y1="17" x2="15" y2="17" stroke={c} strokeWidth="0.8" opacity="0.3" />
    </>
  ),

  // ── Collaboration ──
  'meeting-table-4': (c) => (
    <>
      <rect x="9" y="10" width="14" height="12" rx="3" stroke={c} strokeWidth="1.5" fill="none" />
      <circle cx="16" cy="6" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="16" cy="26" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="5" cy="16" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="27" cy="16" r="2" stroke={c} strokeWidth="1" fill="none" />
    </>
  ),

  'meeting-table-8': (c) => (
    <>
      <rect x="7" y="9" width="18" height="14" rx="3" stroke={c} strokeWidth="1.5" fill="none" />
      {/* 8 chairs around */}
      <circle cx="11" cy="5" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="21" cy="5" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="11" cy="27" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="21" cy="27" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="4" cy="12" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="4" cy="20" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="28" cy="12" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
      <circle cx="28" cy="20" r="1.8" stroke={c} strokeWidth="0.8" fill="none" />
    </>
  ),

  'sofa-set': (c) => (
    <>
      {/* L-shape sofa */}
      <path
        d="M6 8 L6 24 L20 24 L20 18 L12 18 L12 8 Z"
        stroke={c}
        strokeWidth="1.5"
        fill="none"
        rx="2"
      />
      {/* Coffee table */}
      <circle cx="22" cy="12" r="3" stroke={c} strokeWidth="1" fill="none" opacity="0.6" />
    </>
  ),

  'standing-table': (c) => (
    <>
      <circle cx="16" cy="16" r="6" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Center post */}
      <circle cx="16" cy="16" r="1.5" fill={c} opacity="0.3" />
    </>
  ),

  // ── Infrastructure ──
  'network-switch': (c) => (
    <>
      <rect x="6" y="12" width="20" height="8" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Ports */}
      {[10, 13, 16, 19, 22].map((x) => (
        <circle key={x} cx={x} cy="16" r="1" fill={c} opacity="0.5" />
      ))}
    </>
  ),

  'cable-tray': (c) => (
    <>
      <rect x="4" y="13" width="24" height="6" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Cable lines */}
      <line x1="6" y1="15" x2="26" y2="15" stroke={c} strokeWidth="0.6" opacity="0.3" />
      <line x1="6" y1="17" x2="26" y2="17" stroke={c} strokeWidth="0.6" opacity="0.3" />
    </>
  ),

  'patch-panel': (c) => (
    <>
      <rect x="6" y="10" width="20" height="12" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Port grid */}
      {[14, 18].map((y) =>
        [10, 13, 16, 19, 22].map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x - 1}
            y={y - 1}
            width="2"
            height="2"
            rx="0.3"
            stroke={c}
            strokeWidth="0.6"
            fill="none"
            opacity="0.5"
          />
        )),
      )}
    </>
  ),

  // ── Decorative ──
  'plant-small': (c) => (
    <>
      <circle cx="16" cy="14" r="6" stroke={c} strokeWidth="1.2" fill="none" opacity="0.6" />
      <circle cx="16" cy="12" r="3" stroke={c} strokeWidth="1" fill="none" />
      {/* Pot */}
      <rect x="13" y="21" width="6" height="5" rx="1" stroke={c} strokeWidth="1.2" fill="none" />
    </>
  ),

  'plant-large': (c) => (
    <>
      <circle cx="16" cy="12" r="8" stroke={c} strokeWidth="1.2" fill="none" opacity="0.4" />
      <circle cx="16" cy="11" r="5" stroke={c} strokeWidth="1" fill="none" opacity="0.6" />
      <circle cx="16" cy="10" r="2.5" stroke={c} strokeWidth="1" fill="none" />
      <rect x="13" y="22" width="6" height="5" rx="1" stroke={c} strokeWidth="1.2" fill="none" />
    </>
  ),

  'coffee-table': (c) => (
    <>
      <rect x="9" y="11" width="14" height="10" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Cup */}
      <circle cx="14" cy="16" r="1.5" stroke={c} strokeWidth="0.8" fill="none" opacity="0.5" />
    </>
  ),

  'vending-machine': (c) => (
    <>
      <rect x="9" y="5" width="14" height="22" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Display window */}
      <rect
        x="11"
        y="8"
        width="10"
        height="8"
        rx="1"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
      />
      {/* Dispenser slot */}
      <rect
        x="12"
        y="20"
        width="8"
        height="3"
        rx="1"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.4"
      />
    </>
  ),

  'water-cooler': (c) => (
    <>
      {/* Bottle */}
      <rect x="12" y="4" width="8" height="8" rx="4" stroke={c} strokeWidth="1.2" fill="none" />
      {/* Base */}
      <rect x="10" y="12" width="12" height="14" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Tap */}
      <circle cx="16" cy="18" r="1.5" stroke={c} strokeWidth="0.8" fill="none" opacity="0.5" />
    </>
  ),

  'reading-table': (c) => (
    <>
      <rect x="7" y="10" width="18" height="12" rx="2" stroke={c} strokeWidth="1.5" fill="none" />
      <circle cx="11" cy="7" r="2" stroke={c} strokeWidth="1" fill="none" />
      <circle cx="21" cy="25" r="2" stroke={c} strokeWidth="1" fill="none" />
      {/* Book */}
      <rect
        x="12"
        y="13"
        width="5"
        height="3"
        rx="0.5"
        stroke={c}
        strokeWidth="0.8"
        fill="none"
        opacity="0.4"
      />
    </>
  ),

  'chair-standalone': (c) => (
    <>
      <circle cx="16" cy="16" r="5" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Seat */}
      <circle cx="16" cy="16" r="2.5" fill={c} opacity="0.15" />
      {/* Wheels */}
      {[0, 72, 144, 216, 288].map((deg) => {
        const r = 7;
        const x = 16 + r * Math.cos((deg * Math.PI) / 180);
        const y = 16 + r * Math.sin((deg * Math.PI) / 180);
        return <circle key={deg} cx={x} cy={y} r="1" fill={c} opacity="0.3" />;
      })}
    </>
  ),

  'status-board': (c) => (
    <>
      <rect x="6" y="6" width="20" height="16" rx="1" stroke={c} strokeWidth="1.5" fill="none" />
      {/* Rows */}
      <line x1="8" y1="11" x2="24" y2="11" stroke={c} strokeWidth="0.6" opacity="0.3" />
      <line x1="8" y1="15" x2="24" y2="15" stroke={c} strokeWidth="0.6" opacity="0.3" />
      {/* Status dots */}
      <circle cx="22" cy="9" r="1" fill="#22c55e" opacity="0.7" />
      <circle cx="22" cy="13" r="1" fill="#f59e0b" opacity="0.7" />
      <circle cx="22" cy="17" r="1" fill="#ef4444" opacity="0.7" />
      {/* Stand */}
      <line x1="16" y1="22" x2="16" y2="27" stroke={c} strokeWidth="1.2" />
      <line x1="11" y1="27" x2="21" y2="27" stroke={c} strokeWidth="1.2" />
    </>
  ),
};
