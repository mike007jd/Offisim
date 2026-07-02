import { useUiState } from '@/app/ui-state.js';
import {
  type FlowCueTarget,
  type SceneInk,
  type WorkloadChipTone,
  bundleEmphasis,
} from '@/assistant/runtime/scene-cue-projection.js';
import { useSceneCueFrame } from '@/assistant/runtime/scene-cue-react.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import type { ZoneKind } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { CANVAS_FONT_TOKENS } from '@/styles/visual-tokens.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compactSceneEmployeeName } from './scene-labels.js';
import { archetypeToKind, clamp, floorBounds } from './scene-layout.js';
import { useSceneStagingInputs } from './use-scene-staging-inputs.js';

const ZONE_TINT: Record<ZoneKind, string> = {
  workspace: OFFICE_SCENE_2D_COLORS.zoneWorkspace,
  meeting: OFFICE_SCENE_2D_COLORS.zoneMeeting,
  lounge: OFFICE_SCENE_2D_COLORS.zoneLounge,
};

/**
 * THE one 2D ink→hex table: every SceneCue ink role maps to exactly one
 * palette line/packet pair. Approval is amber — never the risk red (PRD) —
 * and neutral is the quiet slate used for recovery signals.
 */
const INK_2D: Record<SceneInk, { readonly line: string; readonly packet: string }> = {
  work: { line: OFFICE_SCENE_2D_COLORS.flowLine, packet: OFFICE_SCENE_2D_COLORS.flowPacket },
  artifact: {
    line: OFFICE_SCENE_2D_COLORS.artifactLine,
    packet: OFFICE_SCENE_2D_COLORS.artifactPacket,
  },
  risk: {
    line: OFFICE_SCENE_2D_COLORS.resourceLine,
    packet: OFFICE_SCENE_2D_COLORS.resourcePacket,
  },
  approval: {
    line: OFFICE_SCENE_2D_COLORS.approvalLine,
    packet: OFFICE_SCENE_2D_COLORS.approvalPacket,
  },
  neutral: {
    line: OFFICE_SCENE_2D_COLORS.neutralLine,
    packet: OFFICE_SCENE_2D_COLORS.neutralPacket,
  },
};

/**
 * THE one 2D workload-chip tone→hex table (same discipline as INK_2D): every
 * chip tone maps to exactly one palette fill.
 */
const CHIP_TONE_2D: Record<WorkloadChipTone, string> = {
  work: OFFICE_SCENE_2D_COLORS.flowPacket,
  wait: OFFICE_SCENE_2D_COLORS.deliveryShelfLine,
  risk: OFFICE_SCENE_2D_COLORS.resourcePacket,
  done: OFFICE_SCENE_2D_COLORS.artifactPacket,
};

/** A circular hit target: an employee actor whose click opens its thread. */
interface EmployeeHit {
  kind: 'employee';
  employeeId: string;
  threadId: string;
  sx: number;
  sy: number;
  r: number;
}

/** A rectangular hit target for the interactive bubble / marker surfaces. */
interface RectHit {
  kind: 'drilldown' | 'delivery';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  employeeId?: string;
}

type Hit = EmployeeHit | RectHit;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function OfficeScene2D() {
  const projectId = useUiState((s) => s.projectId);
  const openThread = useUiState((s) => s.openThread);
  const openStageView = useUiState((s) => s.openStageView);
  const openWorkloadDrilldown = useUiState((s) => s.openWorkloadDrilldown);

  // Shared staging inputs (real zones + real roster + seat planner); the
  // synthetic fallback only applies when there is no backend (dev preview).
  const { roster, zoneDefs, positions, stagingPrefabs } = useSceneStagingInputs();
  const { floorW, floorD } = useMemo(() => floorBounds(zoneDefs), [zoneDefs]);

  // Hover is this scene's only local interaction state; it feeds the hook so
  // ActorCue.hovered carries it back as a cue (never a per-scene derivation).
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);

  // THE render contract: one SceneCueFrame per render, shared with the 3D
  // scene and the drilldown. All runtime facts (staging, flows, delivery,
  // workload bubbles, selection) come from here — along with the shared
  // actorById index; only geometry stays local.
  const { frame, actorById } = useSceneCueFrame({
    prefabs: stagingPrefabs,
    actorPositions: positions,
    hoveredEmployeeId,
  });
  const selectedEmployeeId = useMemo(
    () => frame.actors.find((actor) => actor.selected)?.employeeId ?? null,
    [frame.actors],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);
  // Latest draw closure, refreshed every render. The ResizeObserver setup and
  // the frame-driven draw effect below both call through this ref, so neither
  // tears down when the frame identity changes.
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const pad = 48;
      const scale = Math.min((cw - pad * 2) / floorW, (ch - pad * 2) / floorD);
      const ox = cw / 2;
      const oy = ch / 2;
      const wx = (x: number) => ox + x * scale;
      const wy = (z: number) => oy + z * scale;

      // floor
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
      roundRect(ctx, wx(-floorW / 2), wy(-floorD / 2), floorW * scale, floorD * scale, 14);
      ctx.fill();
      ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.floorLine;
      ctx.stroke();

      // No canvas grid: the surrounding .off-stage already carries the ambient
      // CSS grid texture; a second in-canvas grid double-textures at the host
      // seam (different pitch + color source on each side of the border).

      // Anything drawn opaquely registers a box here so later passes (name
      // labels) can dodge it: zone titles first, then each employee's disc.
      const occupied: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];

      // zones
      ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
      for (const zone of zoneDefs) {
        ctx.fillStyle = ZONE_TINT[archetypeToKind(zone.archetype)];
        roundRect(
          ctx,
          wx(zone.cx - zone.w / 2),
          wy(zone.cz - zone.d / 2),
          zone.w * scale,
          zone.d * scale,
          10,
        );
        ctx.fill();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
        const title = zone.label.toUpperCase();
        const titleX = wx(zone.cx - zone.w / 2) + 10;
        const titleY = wy(zone.cz - zone.d / 2) + 18;
        ctx.fillText(title, titleX, titleY);
        const titleW = ctx.measureText(title).width;
        occupied.push({ x0: titleX - 2, x1: titleX + titleW + 2, y0: titleY - 10, y1: titleY + 4 });
      }

      // employees — real roster, seated by the shared layout helper
      hitsRef.current = [];
      // Proportional to the floor scale with bounds, never a hard floor: a
      // fixed px minimum decouples from the world-unit seat spacing/edge
      // margins and overflows zone rects on narrow stages.
      const r = Math.min(16, Math.max(9, scale * 0.42));
      // The running ring draws at r + 5 with a 2.5px stroke.
      const ringPad = 6;
      // Zone title sits in the top 18px band (+ descenders); keeping discs
      // below it means the title can never be painted over.
      const titleBand = 22;
      // Below-the-dot label box bottoms out at sy + r + 22 (slot + 4).
      const labelBand = 16;
      // Like scene-layout's clamp, plus a degenerate-span midpoint (a zone
      // narrower on screen than the disc's painted extent has min > max).
      const clampSpan = (v: number, min: number, max: number) =>
        min > max ? (min + max) / 2 : clamp(v, min, max);
      // The selected employee draws first so its name label always wins a slot.
      const ordered =
        selectedEmployeeId == null
          ? roster
          : [...roster].sort((a, b) =>
              a.id === selectedEmployeeId ? -1 : b.id === selectedEmployeeId ? 1 : 0,
            );
      const zoneById = new Map(zoneDefs.map((zone) => [zone.id, zone]));

      const screenForEmployee = (employeeId: string) => {
        const pos = positions.get(employeeId);
        if (!pos) return null;
        // Relocation comes from the frame's staging cue (after the dramaturgy
        // mode + reduced-motion cut), drawn precisely at the world anchor with
        // no zone clamp — 2D and 3D agree on where each actor is.
        const staging = actorById.get(employeeId)?.staging;
        const staged =
          staging?.x != null && staging.z != null ? { x: staging.x, z: staging.z } : null;
        let sx = wx(staged ? staged.x : pos.x);
        let sy = wy(staged ? staged.z : pos.z);
        const zone = staged ? undefined : zoneById.get(pos.zoneId);
        if (zone) {
          sx = clampSpan(
            sx,
            wx(zone.cx - zone.w / 2) + r + ringPad,
            wx(zone.cx + zone.w / 2) - r - ringPad,
          );
          sy = clampSpan(
            sy,
            wy(zone.cz - zone.d / 2) + titleBand + r + ringPad,
            wy(zone.cz + zone.d / 2) - r - ringPad - labelBand,
          );
        }
        return { sx, sy };
      };

      // World→pixel anchor per flow target — the only flow geometry this scene
      // owns (the target itself is the cue's vocabulary, never re-derived).
      const flowTarget = (target: FlowCueTarget) => {
        switch (target) {
          case 'delivery':
            return { sx: wx(floorW / 2 - 2.7), sy: wy(floorD / 2 - 2.0) };
          case 'tool':
            return { sx: wx(floorW / 2 - 4.8), sy: wy(-floorD / 2 + 3.2) };
          case 'review':
            return { sx: wx(-floorW / 2 + 4.2), sy: wy(-floorD / 2 + 3.3) };
          case 'user':
            return { sx: wx(0), sy: wy(floorD / 2 - 1.7) };
          default:
            return { sx: wx(0), sy: wy(0) };
        }
      };

      // Flow layer: bundled cues from the frame — one line per (actor, target,
      // kind). The shared bundleEmphasis rule adds the heavier stroke for
      // bundled (≥2) cues on top of this scene's risk-aware base, capped at
      // 3px (the full visual language is a later increment).
      for (const cue of frame.flows) {
        const source = screenForEmployee(cue.employeeId);
        if (!source) continue;
        const target = flowTarget(cue.target);
        const ink = INK_2D[cue.ink];
        ctx.save();
        ctx.strokeStyle = ink.line;
        ctx.lineWidth = Math.min(3, (cue.ink === 'risk' ? 2.2 : 1.6) + bundleEmphasis(cue));
        ctx.setLineDash(cue.pulse ? [] : [4, 5]);
        ctx.beginPath();
        const mx = (source.sx + target.sx) / 2;
        const my = Math.min(source.sy, target.sy) - 30;
        ctx.moveTo(source.sx, source.sy);
        ctx.quadraticCurveTo(mx, my, target.sx, target.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        const t = ((Date.now() - cue.at) % 1400) / 1400;
        const px = (1 - t) ** 2 * source.sx + 2 * (1 - t) * t * mx + t ** 2 * target.sx;
        const py = (1 - t) ** 2 * source.sy + 2 * (1 - t) * t * my + t ** 2 * target.sy;
        ctx.fillStyle = ink.packet;
        ctx.beginPath();
        ctx.arc(px, py, cue.ink === 'risk' ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Delivery shelf — reads the frame's delivery cue: ×N from recentCount,
      // click target from `latest` (resolved in the click handler). With no
      // live claim there is no shelf and no hit.
      if (frame.delivery.latest) {
        const shelf = flowTarget('delivery');
        const shelfW = 116;
        const shelfH = 34;
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
        roundRect(ctx, shelf.sx - shelfW / 2, shelf.sy - shelfH / 2, shelfW, shelfH, 8);
        ctx.fill();
        ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
        ctx.stroke();
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
        ctx.textAlign = 'center';
        ctx.fillText('DELIVERY', shelf.sx, shelf.sy - 2);
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
        ctx.fillText(`×${frame.delivery.recentCount}`, shelf.sx, shelf.sy + 11);
        ctx.textAlign = 'left';
        hitsRef.current.push({
          kind: 'delivery',
          x0: shelf.sx - shelfW / 2,
          y0: shelf.sy - shelfH / 2,
          x1: shelf.sx + shelfW / 2,
          y1: shelf.sy + shelfH / 2,
        });
      }

      for (const employee of ordered) {
        const pos = positions.get(employee.id);
        if (!pos) continue;
        const cue = actorById.get(employee.id);
        const running = cue?.running ?? false;
        const active = cue?.selected ?? false;
        const hovered = cue?.hovered ?? false;
        const wl = cue?.workload ?? null;
        // Blocked primary slot: a blocked-severity issue owns the bubble.
        const blocked = wl?.primary === 'issue';
        const colors = resolveAppearance(employee.id, employee.appearance);
        const screen = screenForEmployee(employee.id);
        if (!screen) continue;
        const { sx, sy } = screen;

        // desk — below ~14px/unit it is no longer legible as furniture
        if (scale >= 14) {
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.desk;
          roundRect(ctx, sx - r * 1.1, sy + r * 0.5, r * 2.2, r * 0.9, 4);
          ctx.fill();
        }

        // running / active ring — the pulsing "at work" ring never renders
        // over a blocked actor (blocked wins visually); selection still draws.
        const showRunningRing = running && !blocked;
        if (showRunningRing || active) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = showRunningRing
            ? OFFICE_SCENE_2D_COLORS.activeRing
            : OFFICE_SCENE_2D_COLORS.activeRingSoft;
          ctx.lineWidth = showRunningRing ? 2.5 : 1.5;
          ctx.stroke();
        }

        // Hover ring — a subtle affordance from ActorCue.hovered, distinct
        // from the selected/running ring by radius and translucency.
        if (hovered) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.flowLine;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Grouped bubble: the frame's WorkloadCue drives the ×N badge, the
        // resource-marker hierarchy, and the chip row. When the cue's primary
        // slot is 'issue', the issue marker takes the top-right primary slot
        // and the ×N count demotes to the top-left secondary slot.
        if (wl?.countLabel) {
          const bx = blocked ? sx - r - 3 : sx + r + 3;
          const by = sy - r - 3;
          ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
          ctx.textAlign = 'center';
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.activeRing;
          ctx.fillText(wl.countLabel, bx, by);
          ctx.textAlign = 'left';
          occupied.push({ x0: bx - 9, x1: bx + 9, y0: by - 9, y1: by + 5 });
        }

        // Resource marker — keyed off the cue's top issue (exhausted >
        // blocked > warning). Primary (top-right) when the issue leads the
        // bubble; secondary (top-left) otherwise, clear of the ×N badge.
        const topIssue = wl?.topIssue ?? null;
        if (topIssue) {
          const mx = blocked ? sx + r + 5 : sx - r - 5;
          const my = sy - r - 4;
          if (topIssue.severity === 'exhausted') {
            // Strongest: a larger filled disc with a '!' glyph.
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.resourcePacket;
            ctx.beginPath();
            ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
            ctx.textAlign = 'center';
            ctx.fillText('!', mx, my + 4);
            ctx.textAlign = 'left';
          } else if (topIssue.severity === 'blocked') {
            // Medium: a plain filled disc.
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.resourcePacket;
            ctx.beginPath();
            ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Subtle: a small hollow ring in the translucent resource ink.
            ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.resourceLine;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(mx, my, 3.6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Chip row — the bubble is capped to fixed dimensions. small keeps the
        // 3-char per-run look; medium/large draw grouped chips with their count
        // ("Blocked 3", "Research 24") in pills widened to the measured text so
        // the count is never clipped. The cue already caps chips at 4.
        if (wl && wl.chips.length > 0) {
          const isGrouped = wl.tier !== 'small';
          ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
          ctx.textAlign = 'center';
          const cy = sy + r + 32;
          const chipPad = 7;
          const chipH = 12;
          const gap = 4;
          const overflowW = 24;
          type ChipCell = { text: string; tone: (typeof wl.chips)[number]['tone']; w: number };
          const cells: ChipCell[] = wl.chips.map((chip) => {
            const text = isGrouped
              ? chip.count != null
                ? `${chip.label} ${chip.count}`
                : chip.label
              : chip.label.slice(0, 3);
            const w = isGrouped ? ctx.measureText(text).width + chipPad * 2 : 22;
            return { text, tone: chip.tone, w };
          });
          const totalW =
            cells.reduce((sum, c) => sum + c.w, 0) +
            (cells.length - 1) * gap +
            (wl.overflow ? overflowW + gap : 0);
          let cx = sx - totalW / 2;
          const cyTop = cy - chipH / 2;
          for (const cell of cells) {
            ctx.fillStyle = CHIP_TONE_2D[cell.tone];
            roundRect(ctx, cx, cyTop, cell.w, chipH, 6);
            ctx.fill();
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
            ctx.fillText(cell.text, cx + cell.w / 2, cy + 4);
            cx += cell.w + gap;
          }
          // Overflow affordance — a compact "+more" pill that opens the same
          // read-only drilldown as the bubble region.
          if (wl.overflow) {
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
            roundRect(ctx, cx, cyTop, overflowW, chipH, 6);
            ctx.fill();
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
            ctx.fillText('+…', cx + overflowW / 2, cy + 4);
          }
          ctx.textAlign = 'left';

          // Drilldown hit rect over the whole chip row (including the overflow
          // pill). Clicking anywhere on the bubble opens the inspect drawer.
          hitsRef.current.push({
            kind: 'drilldown',
            employeeId: employee.id,
            x0: sx - totalW / 2,
            y0: cyTop,
            x1: sx + totalW / 2,
            y1: cyTop + chipH,
          });
        }

        // body (clothing) disc
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle =
          employee.kind === 'external' ? OFFICE_SCENE_2D_COLORS.externalClothing : colors.clothing;
        ctx.fill();
        // head (skin) inner disc
        ctx.beginPath();
        ctx.arc(sx, sy - r * 0.12, r * 0.52, 0, Math.PI * 2);
        ctx.fillStyle =
          employee.kind === 'external' ? OFFICE_SCENE_2D_COLORS.externalSkin : colors.skin;
        ctx.fill();

        // name — collision-aware against everything registered so far (zone
        // titles, earlier discs, earlier labels): flip above the dot if the
        // below-slot is taken, drop the label entirely if both slots collide
        // (dot + selection ring still identify; the selected employee draws
        // first so it always keeps its label).
        const labelText = compactSceneEmployeeName(employee.name);
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        const labelW = ctx.measureText(labelText).width;
        const boxAt = (ly: number) => ({
          x0: sx - labelW / 2 - 2,
          x1: sx + labelW / 2 + 2,
          y0: ly - 10,
          y1: ly + 4,
        });
        const slots = [sy + r + 18, sy - r - 8];
        const slot = slots.find((ly) => {
          const box = boxAt(ly);
          return !occupied.some(
            (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
          );
        });
        if (slot !== undefined) {
          occupied.push(boxAt(slot));
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
          ctx.textAlign = 'center';
          ctx.fillText(labelText, sx, slot);
          ctx.textAlign = 'left';
        }
        // Register the disc+ring footprint only after this employee's own
        // label is placed — the above-slot box grazes the ring box by 2px and
        // must not be blocked by the employee's own disc.
        occupied.push({
          x0: sx - r - ringPad,
          x1: sx + r + ringPad,
          y0: sy - r - ringPad,
          y1: sy + r + ringPad,
        });

        if (cue?.threadId) {
          hitsRef.current.push({
            kind: 'employee',
            employeeId: employee.id,
            threadId: cue.threadId,
            sx,
            sy,
            r: r + 6,
          });
        }
      }
    };
  });

  // Setup effect: canvas mount only — resize redraws through drawRef, so the
  // observer never re-subscribes on frame identity changes.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Draw effect: one draw per decorated frame; while any flow pulses, a RAF
  // loop keeps the packet animation moving (the exact pre-split behavior).
  useEffect(() => {
    let raf = 0;
    const hasPulsingFlow = frame.flows.some((cue) => cue.pulse);
    const tick = () => {
      drawRef.current();
      raf = hasPulsingFlow ? window.requestAnimationFrame(tick) : 0;
    };
    tick();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [frame]);

  // Hit testing walks registration order in REVERSE so the topmost-drawn
  // target wins — later employees' chip rows paint over earlier ones, so a
  // pointer on an overlap must resolve to what the user actually sees.
  // Employee-body hits are still authoritative: they win over ANY overlapping
  // bubble/shelf rect, so a wide neighbour chip row can never steal a body
  // click (thread selection is never hijacked). Index loops: this runs on
  // every pointermove, so no per-move slice().reverse() allocation.
  const hitAt = (px: number, py: number): Hit | null => {
    const hits = hitsRef.current;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const h = hits[i];
      if (h?.kind === 'employee' && Math.hypot(px - h.sx, py - h.sy) <= h.r) return h;
    }
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const h = hits[i];
      if (h && h.kind !== 'employee' && px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) {
        return h;
      }
    }
    return null;
  };

  // A zero-zone (empty) office draws the bare floor slab with nobody seated —
  // employeePlacements returns no seats for zero zones; OfficeStage owns the
  // "No office layout yet" overlay for both render modes.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: canvas hit-test is a pointer convenience; employees are keyboard-selectable via the team dock and thread list
    <canvas
      ref={canvasRef}
      className="off-scene-canvas"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top);
        // Interactive hits (employee, bubble, shelf) read as clickable.
        e.currentTarget.style.cursor = hit ? 'pointer' : '';
        const next = hit?.kind === 'employee' ? hit.employeeId : null;
        setHoveredEmployeeId((prev) => (prev === next ? prev : next));
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.cursor = '';
        setHoveredEmployeeId(null);
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit) return;
        if (hit.kind === 'employee') {
          openThread(hit.threadId);
          return;
        }
        if (hit.kind === 'drilldown') {
          if (hit.employeeId) openWorkloadDrilldown(hit.employeeId);
          return;
        }
        // delivery — open the frame's latest claim (carries threadId so the
        // output surface loads in-thread, identical to the 3D shelf).
        const latest = frame.delivery.latest;
        if (latest) {
          void openArtifactClaim(latest, { openStageView, projectId });
        }
      }}
    />
  );
}
