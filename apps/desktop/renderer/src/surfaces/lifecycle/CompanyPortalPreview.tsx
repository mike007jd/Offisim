import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { Company } from '@/data/types.js';
import type { CompanyBrief } from './lifecycle-data.js';

const ZONE_TINTS = [
  UI_DATA_COLORS.blue,
  UI_DATA_COLORS.violet,
  UI_DATA_COLORS.green,
  UI_DATA_COLORS.amber3,
] as const;

/** Portal office preview: a wide top-down SVG of the selected company's floor —
 *  24px grid + zones as accent-tinted rounded rects with caps labels + per-zone
 *  asset count + prefab instances as small dots. Mirrors the portal spec. */
export function CompanyPortalPreview({
  company,
  brief,
}: { company: Company; brief: CompanyBrief }) {
  const W = 720;
  const H = 480;
  const gridId = `csp-grid-${company.id}`;

  // Lay zones out into a simple two-row plan that scales with zone count.
  const zones = brief.zoneNames.slice(0, 4).map((name, i) => {
    const accent = ZONE_TINTS[i % ZONE_TINTS.length] ?? UI_DATA_COLORS.blue;
    const isWide = brief.zoneNames.length <= 2 || i === brief.zoneNames.length - 1;
    if (i === 0) return { name, accent, x: 40, y: 40, w: 300, h: 180 };
    if (i === 1) return { name, accent, x: 360, y: 40, w: 320, h: 180 };
    if (i === 2 && isWide) return { name, accent, x: 40, y: 240, w: 640, h: 200 };
    if (i === 2) return { name, accent, x: 40, y: 240, w: 300, h: 200 };
    return { name, accent, x: 360, y: 240, w: 320, h: 200 };
  });

  // Distribute asset dots across the floor deterministically.
  const dotCount = Math.min(brief.assetCount, 9);
  const dots = Array.from({ length: dotCount }, (_, i) => ({
    cx: 90 + ((i * 137) % 560),
    cy: 90 + ((i * 211) % 300),
  }));

  return (
    <svg
      className="off-csp-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${company.name} office preview`}
    >
      <defs>
        <pattern id={gridId} width={24} height={24} patternUnits="userSpaceOnUse">
          <path
            d="M 24 0 L 0 0 0 24"
            fill="none"
            stroke="var(--off-line)"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect width={W} height={H} rx={14} fill="var(--off-surface-sunken)" />
      <rect width={W} height={H} rx={14} fill={`url(#${gridId})`} />
      {zones.map((z, i) => {
        const perZone = Math.max(1, Math.round(brief.assetCount / zones.length));
        return (
          <g key={z.name}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={12}
              fill={z.accent}
              fillOpacity={0.12}
              stroke={z.accent}
              strokeOpacity={0.45}
            />
            <text x={z.x + 12} y={z.y + 22} fill={z.accent} fontSize={11} fontWeight={700}>
              {z.name.toUpperCase()}
            </text>
            <text
              x={z.x + z.w - 12}
              y={z.y + 22}
              fill="var(--off-ink-4)"
              fontSize={10}
              textAnchor="end"
            >
              {perZone + (i % 3)} assets
            </text>
          </g>
        );
      })}
      {dots.map((d) => (
        <circle
          key={`${d.cx}-${d.cy}`}
          cx={d.cx}
          cy={d.cy}
          r={4.5}
          fill="var(--off-surface-1)"
          opacity={0.9}
        />
      ))}
    </svg>
  );
}
