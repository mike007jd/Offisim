import { PREVIEW_TINTS } from '@/data/color-palette.js';
import { resolveAppearance } from '@/lib/avatar.js';
import type { ZoneArchetype } from '@offisim/shared-types';
import { FloorGridPattern } from './preview-svg.js';
import type { WizardTemplate } from './template-view.js';

// Landscape floor-plan canvas shared by the template preview and the
// create-your-own blueprint — matches the wide wizard stage.
const W = 560;
const H = 300;
const INSET = 16;
const COL_GAP = 12;
// Hero plot (left) + stacked side plots (right column) for the blueprint art.
const HERO_W = 360;
const SIDE_X = INSET + HERO_W + COL_GAP;
const SIDE_W = W - SIDE_X - INSET;

const ZONE_GAP = 8;

/** Tint a zone rect by its archetype so workspaces, meeting rooms, and the
 *  rest/support zones read distinctly (not by index, which drifts as templates
 *  reorder). */
function tintForArchetype(archetype: ZoneArchetype): string {
  switch (archetype) {
    case 'workspace':
      return PREVIEW_TINTS.workspace;
    case 'meeting':
      return PREVIEW_TINTS.meeting;
    default:
      // server / library / rest — the "support" tint.
      return PREVIEW_TINTS.lounge;
  }
}

interface ZoneRect {
  slug: string;
  label: string;
  archetype: ZoneArchetype;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pack the template's zones into a near-square grid that fills the canvas. The
 *  last row is centered when it has fewer cells than the grid columns. */
function layoutZones(template: WizardTemplate): ZoneRect[] {
  const zones = template.zones;
  const count = zones.length;
  if (count === 0) return [];

  const innerW = W - 2 * INSET;
  const innerH = H - 2 * INSET;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = (innerW - (cols - 1) * ZONE_GAP) / cols;
  const cellH = (innerH - (rows - 1) * ZONE_GAP) / rows;

  return zones.map((zone, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // Cells remaining in this (possibly short) final row — center them.
    const cellsInRow = Math.min(cols, count - row * cols);
    const rowWidth = cellsInRow * cellW + (cellsInRow - 1) * ZONE_GAP;
    const rowX = INSET + (innerW - rowWidth) / 2;
    return {
      slug: zone.slug,
      label: zone.label,
      archetype: zone.archetype,
      x: rowX + col * (cellW + ZONE_GAP),
      y: INSET + row * (cellH + ZONE_GAP),
      w: cellW,
      h: cellH,
    };
  });
}

/** Compact 2D office-layout preview for the create-company wizard: floor + the
 *  template's REAL zones (sorted by sortOrder) with each employee placed inside
 *  their resolved home zone. */
export function TemplatePreview({
  template,
  accentHex,
}: { template: WizardTemplate; accentHex: string }) {
  const zoneRects = layoutZones(template);
  const rectBySlug = new Map(zoneRects.map((z) => [z.slug, z]));
  const fallbackRect = zoneRects[0];

  // Group employees by their home zone so each zone lays out its own seat grid.
  const bySlug = new Map<string, typeof template.employees>();
  for (const emp of template.employees) {
    const slug = (emp.homeZoneSlug && rectBySlug.has(emp.homeZoneSlug)
      ? emp.homeZoneSlug
      : fallbackRect?.slug) ?? '';
    const list = bySlug.get(slug) ?? [];
    list.push(emp);
    bySlug.set(slug, list);
  }

  const seats = zoneRects.flatMap((rect) => {
    const members = bySlug.get(rect.slug) ?? [];
    if (members.length === 0) return [];
    // Lay seats in a grid inside the zone rect, below the zone label band.
    const cols = Math.min(members.length, Math.max(1, Math.floor(rect.w / 34)));
    const rows = Math.ceil(members.length / cols);
    const padX = 14;
    const topBand = 26;
    const availW = rect.w - 2 * padX;
    const availH = rect.h - topBand - 12;
    const stepX = cols > 1 ? availW / (cols - 1) : 0;
    const stepY = rows > 1 ? availH / (rows - 1) : 0;
    return members.map((emp, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = cols > 1 ? rect.x + padX + col * stepX : rect.x + rect.w / 2;
      const cy = rows > 1 ? rect.y + topBand + row * stepY : rect.y + topBand + availH / 2;
      return {
        key: emp.key,
        cx,
        cy,
        color: resolveAppearance(`${template.id}:${emp.name}`, emp.appearance).clothing,
      };
    });
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
      {zoneRects.map((z) => (
        <g key={z.slug}>
          <rect
            x={z.x}
            y={z.y}
            width={z.w}
            height={z.h}
            rx={8}
            fill={tintForArchetype(z.archetype)}
            stroke="var(--off-line)"
          />
          <text x={z.x + 10} y={z.y + 18} className="off-wiz-preview-zone">
            {z.label.toUpperCase()}
          </text>
        </g>
      ))}
      {seats.map((s) => (
        <g key={s.key}>
          <rect
            x={s.cx - 14}
            y={s.cy + 10}
            width={28}
            height={11}
            rx={3}
            fill={PREVIEW_TINTS.seatShadow}
          />
          <circle cx={s.cx} cy={s.cy} r={11} fill={s.color} />
          <circle cx={s.cx} cy={s.cy - 2} r={5.5} fill={PREVIEW_TINTS.seatHighlight} />
        </g>
      ))}
      {/* Accent marker anchored to the meeting zone (or the first zone) so the
          preview keeps an accent cue tied to the template. */}
      {accentHex && fallbackRect ? (
        <circle
          cx={fallbackRect.x + fallbackRect.w - 14}
          cy={fallbackRect.y + 14}
          r={4}
          fill={accentHex}
        />
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
        <FloorGridPattern id="off-wiz-bp-grid" />
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
