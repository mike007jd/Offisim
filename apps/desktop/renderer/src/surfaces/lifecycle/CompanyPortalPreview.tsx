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
 *  24px grid + the company's real office zones as accent-tinted rounded rects
 *  with caps labels. Renders an honest empty plate when no zones exist yet. */
export function CompanyPortalPreview({
  company,
  brief,
}: { company: Company; brief: CompanyBrief }) {
  const W = 720;
  const H = 480;
  const gridId = `csp-grid-${company.id}`;

  // Lay ALL zones out on a simple grid that scales with zone count, so the
  // preview never contradicts the "Zones" stat. The last zone stretches across
  // any leftover columns of its row.
  const count = brief.zoneNames.length;
  const cols = count > 4 ? 3 : Math.min(Math.max(count, 1), 2);
  const rows = Math.ceil(count / cols) || 1;
  const PAD = 40;
  const GAP = 20;
  const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const cellH = (H - PAD * 2 - GAP * (rows - 1)) / rows;
  const zones = brief.zoneNames.map((name, i) => {
    const accent = ZONE_TINTS[i % ZONE_TINTS.length] ?? UI_DATA_COLORS.blue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const span = i === count - 1 ? cols - col : 1;
    return {
      name,
      accent,
      x: PAD + col * (cellW + GAP),
      y: PAD + row * (cellH + GAP),
      w: cellW * span + GAP * (span - 1),
      h: cellH,
    };
  });

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
      {zones.map((z) => (
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
        </g>
      ))}
      {zones.length === 0 ? (
        <text
          x={W / 2}
          y={H / 2}
          fill="var(--off-ink-4)"
          fontSize={13}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          No office layout yet
        </text>
      ) : null}
    </svg>
  );
}
