import { PREVIEW_TINTS } from '@/data/color-palette.js';
import type { CompanyTemplate } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { templateZones } from './lifecycle-data.js';

const PREVIEW_TINT_CYCLE = [
  PREVIEW_TINTS.workspace,
  PREVIEW_TINTS.meeting,
  PREVIEW_TINTS.lounge,
] as const;

/** Compact 2D office-layout preview for the create-company wizard: floor + the
 *  template's real zones (same list as the zone chips) + the template roster
 *  placed as seats in the first zone. */
export function TemplatePreview({
  template,
  accentHex,
}: { template: CompanyTemplate; accentHex: string }) {
  const W = 320;
  const H = 300;
  const INSET = 16;
  const innerH = H - 2 * INSET;
  // First zone gets the hero plot (left, large); the rest stack in a
  // right-hand column so the preview matches the template's zone chips.
  const names = templateZones(template.id);
  const sideCount = names.length - 1;
  const sideH = sideCount > 0 ? Math.floor((innerH - (sideCount - 1) * 8) / sideCount) : 0;
  const zones = names.map((label, i) => {
    const tint = PREVIEW_TINT_CYCLE[i % PREVIEW_TINT_CYCLE.length] ?? PREVIEW_TINTS.workspace;
    if (i === 0) {
      return { label, x: INSET, y: INSET, w: sideCount > 0 ? 184 : W - 2 * INSET, h: innerH, tint };
    }
    const slot = i - 1;
    return { label, x: 212, y: INSET + slot * (sideH + 8), w: 92, h: sideH, tint };
  });
  const dotA = zones[1];
  const dotB = zones.length > 2 ? zones[zones.length - 1] : undefined;
  const seats = template.employees.map((e, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      cx: 52 + col * 52,
      cy: 64 + row * 60,
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
