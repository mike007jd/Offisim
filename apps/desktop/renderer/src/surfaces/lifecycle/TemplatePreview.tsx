import { PREVIEW_TINTS } from '@/data/color-palette.js';
import type { CompanyTemplate } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';

/** Compact 2D office-layout preview for the create-company wizard: floor + the
 *  three default zones + the template roster placed as seats in the workspace. */
export function TemplatePreview({
  template,
  accentHex,
}: { template: CompanyTemplate; accentHex: string }) {
  const W = 320;
  const H = 300;
  // Workspace (left, large), Meeting (top-right), Lounge (bottom-right).
  const zones = [
    { label: 'Workspace', x: 16, y: 16, w: 184, h: 268, tint: PREVIEW_TINTS.workspace },
    { label: 'Meeting', x: 212, y: 16, w: 92, h: 128, tint: PREVIEW_TINTS.meeting },
    { label: 'Lounge', x: 212, y: 156, w: 92, h: 128, tint: PREVIEW_TINTS.lounge },
  ];
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
      <circle cx={258} cy={70} r={5} fill={accentHex} />
      <circle cx={258} cy={210} r={5} fill="var(--off-ink-3)" />
    </svg>
  );
}
