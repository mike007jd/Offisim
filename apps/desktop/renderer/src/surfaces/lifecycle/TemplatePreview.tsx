import { PREVIEW_TINTS } from '@/data/color-palette.js';
import type { CompanyTemplate } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { templateZones } from './lifecycle-data.js';

const PREVIEW_TINT_CYCLE = [
  PREVIEW_TINTS.workspace,
  PREVIEW_TINTS.meeting,
  PREVIEW_TINTS.lounge,
] as const;

// Landscape floor-plan canvas shared by the template preview and the
// create-your-own blueprint — matches the wide wizard stage.
const W = 560;
const H = 300;
const INSET = 16;
const COL_GAP = 12;
// Hero plot (left) + stacked side plots (right column).
const HERO_W = 360;
const SIDE_X = INSET + HERO_W + COL_GAP;
const SIDE_W = W - SIDE_X - INSET;

/** Compact 2D office-layout preview for the create-company wizard: floor + the
 *  template's real zones + the template roster placed as seats in the first
 *  zone. */
export function TemplatePreview({
  template,
  accentHex,
}: { template: CompanyTemplate; accentHex: string }) {
  const innerH = H - 2 * INSET;
  // First zone gets the hero plot (left, large); the rest stack in a
  // right-hand column.
  const names = templateZones(template.id);
  const sideCount = names.length - 1;
  const sideH = sideCount > 0 ? Math.floor((innerH - (sideCount - 1) * 8) / sideCount) : 0;
  const zones = names.map((label, i) => {
    const tint = PREVIEW_TINT_CYCLE[i % PREVIEW_TINT_CYCLE.length] ?? PREVIEW_TINTS.workspace;
    if (i === 0) {
      return {
        label,
        x: INSET,
        y: INSET,
        w: sideCount > 0 ? HERO_W : W - 2 * INSET,
        h: innerH,
        tint,
      };
    }
    const slot = i - 1;
    return { label, x: SIDE_X, y: INSET + slot * (sideH + 8), w: SIDE_W, h: sideH, tint };
  });
  const dotA = zones[1];
  const dotB = zones.length > 2 ? zones[zones.length - 1] : undefined;
  const seats = template.employees.map((e, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      cx: 64 + col * 120,
      cy: 72 + row * 72,
      color: resolveAppearance(`${template.id}:${e.name}`, e.appearance).clothing,
      name: e.name,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="off-wiz-preview-svg"
      role="img"
      aria-label={`${template.name} office layout`}
    >
      <rect
        x={4}
        y={4}
        width={W - 8}
        height={H - 8}
        rx={12}
        fill="var(--off-surface-2)"
        stroke="var(--off-line)"
      />
      {zones.map((z) => (
        <g key={z.label}>
          <rect
            x={z.x}
            y={z.y}
            width={z.w}
            height={z.h}
            rx={8}
            fill={z.tint}
            stroke="var(--off-line)"
          />
          <text x={z.x + 10} y={z.y + 20} className="off-wiz-preview-zone">
            {z.label.toUpperCase()}
          </text>
        </g>
      ))}
      {seats.map((s) => (
        <g key={s.name}>
          <rect
            x={s.cx - 16}
            y={s.cy + 12}
            width={32}
            height={12}
            rx={3}
            fill={PREVIEW_TINTS.seatShadow}
          />
          <circle cx={s.cx} cy={s.cy} r={13} fill={s.color} />
          <circle cx={s.cx} cy={s.cy - 2} r={6.5} fill={PREVIEW_TINTS.seatHighlight} />
        </g>
      ))}
      {dotA ? (
        <circle cx={dotA.x + dotA.w / 2} cy={dotA.y + dotA.h - 16} r={5} fill={accentHex} />
      ) : null}
      {dotB ? (
        <circle cx={dotB.x + dotB.w / 2} cy={dotB.y + dotB.h - 16} r={5} fill="var(--off-ink-3)" />
      ) : null}
    </svg>
  );
}

// Dashed placeholder plots echo the template previews' hero + side structure
// so the blueprint reads as "your zones go here", not as a broken preview.
const BLUEPRINT_PLOTS = [
  { x: INSET, y: INSET, w: HERO_W, h: H - 2 * INSET },
  { x: SIDE_X, y: INSET, w: SIDE_W, h: 128 },
  { x: SIDE_X, y: INSET + 128 + COL_GAP, w: SIDE_W, h: 128 },
] as const;

/** Blank-blueprint stage art for the create-your-own template: same floor
 *  plate and token language as TemplatePreview, with dashed empty zone
 *  placeholders over a grid — the office is laid out later in Studio. */
export function CyoBlueprint() {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="off-wiz-blueprint-svg"
      role="img"
      aria-label="Empty office plot, laid out later in Studio"
    >
      <defs>
        <pattern id="off-wiz-bp-grid" width={24} height={24} patternUnits="userSpaceOnUse">
          <path
            d="M 24 0 L 0 0 0 24"
            fill="none"
            stroke="var(--off-line)"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect
        x={4}
        y={4}
        width={W - 8}
        height={H - 8}
        rx={12}
        fill="var(--off-surface-2)"
        stroke="var(--off-line)"
      />
      <rect x={4} y={4} width={W - 8} height={H - 8} rx={12} fill="url(#off-wiz-bp-grid)" />
      {BLUEPRINT_PLOTS.map((p) => (
        <g key={`${p.x}-${p.y}`}>
          <rect
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            rx={8}
            fill="none"
            stroke="var(--off-line-strong)"
            strokeDasharray="6 5"
          />
          <text
            x={p.x + p.w / 2}
            y={p.y + p.h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="off-wiz-blueprint-plus"
          >
            +
          </text>
        </g>
      ))}
    </svg>
  );
}
