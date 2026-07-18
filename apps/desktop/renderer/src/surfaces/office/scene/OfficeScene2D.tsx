import { useUiState } from '@/app/ui-state.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import {
  FLOW_TARGET_LABELS,
  type FlowCueTarget,
  RESOURCE_KIND_GLYPHS,
  type SceneInk,
  type WorkloadChipTone,
  bundleEmphasis,
  flowCueText,
} from '@/assistant/runtime/scene-cue-projection.js';
import { useSceneCueFrame } from '@/assistant/runtime/scene-cue-react.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { employeeSeniorityLabel } from '@/data/employee-seniority.js';
import type { ZoneKind } from '@/data/types.js';
import { seniorityForEmployee, useEmployeeSeniorityRoster } from '@/data/use-employee-seniority.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openDeliveryHistory } from './delivery-history.js';
import { useCodexPet } from './office-companion/CodexPetProvider.js';
import { CODEX_PET_ATLAS, codexPetAtlasFrame } from './office-companion/codex-pet-animation.js';
import {
  type OfficeCompanionPlan,
  buildOfficeCompanionCandidates,
  createOfficeCompanionPlan,
  officeCompanionOccupiedPoints,
  officeCompanionPlanKey,
  officeCompanionSpatialRevision,
  sampleOfficeCompanionPlan,
} from './office-companion/companion-projection.js';
import { OFFICE_DELIVERY_WORLD, officeResourceMarkerColor } from './office-visual-language.js';
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
  wait: OFFICE_SCENE_2D_COLORS.approvalPacket,
  risk: OFFICE_SCENE_2D_COLORS.resourcePacket,
  done: OFFICE_SCENE_2D_COLORS.artifactPacket,
};

/** A circular hit target: an employee actor whose click opens its thread. */
interface EmployeeHit {
  kind: 'employee';
  employeeId: string;
  threadId: string | null;
  sx: number;
  sy: number;
  r: number;
}

/** A rectangular hit target for the interactive bubble / marker / shelf surfaces. */
interface RectHit {
  kind: 'drilldown' | 'delivery' | 'delivery-chip';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  employeeId?: string;
  /** Index into frame.delivery.chips for a 'delivery-chip' hit. */
  chipIndex?: number;
}

type Hit = EmployeeHit | RectHit;

interface CanvasBackingStore {
  width: number;
  height: number;
  style: { width: string; height: string };
}

export function syncOfficeCanvasBackingStore(
  canvas: CanvasBackingStore,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): boolean {
  const pixelWidth = Math.max(0, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(0, Math.round(cssHeight * dpr));
  const cssWidthValue = `${cssWidth}px`;
  const cssHeightValue = `${cssHeight}px`;
  let changed = false;
  if (canvas.width !== pixelWidth) {
    canvas.width = pixelWidth;
    changed = true;
  }
  if (canvas.height !== pixelHeight) {
    canvas.height = pixelHeight;
    changed = true;
  }
  if (canvas.style.width !== cssWidthValue) canvas.style.width = cssWidthValue;
  if (canvas.style.height !== cssHeightValue) canvas.style.height = cssHeightValue;
  return changed;
}

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

export function OfficeScene2D({ pip = false }: { pip?: boolean }) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const officeMode = useUiState((s) => s.officeMode);
  const companionEnabled = useUiState((s) => s.officeCompanionEnabled);
  const { atlasUrl: companionAtlasUrl } = useCodexPet();
  const openThread = useUiState((s) => s.openThread);
  const openStageView = useUiState((s) => s.openStageView);
  const openWorkloadDrilldown = useUiState((s) => s.openWorkloadDrilldown);

  // Shared staging inputs (real zones + real roster + seat planner); the
  // synthetic fallback only applies when there is no backend (dev preview).
  const { roster, zoneDefs, positions, stagingPrefabs, pathfinder, routeFor, routeSignature } =
    useSceneStagingInputs();
  const seniority = useEmployeeSeniorityRoster(companyId, roster);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const { floorW, floorD } = useMemo(() => floorBounds(zoneDefs), [zoneDefs]);

  // THE render contract: one SceneCueFrame per render, shared with the 3D
  // scene and the drilldown. All runtime facts (staging, flows, delivery,
  // workload bubbles, selection) come from here — along with the shared
  // actorById index; only geometry stays local.
  const { frame, actorById } = useSceneCueFrame({
    prefabs: stagingPrefabs,
    actorPositions: positions,
    routeFor,
    routeSignature,
  });
  const selectedEmployeeId = useMemo(
    () => frame.actors.find((actor) => actor.selected)?.employeeId ?? null,
    [frame.actors],
  );

  // ── Hoisted draw inputs: the draw closure below runs on every RAF tick
  // (~60×/s while any flow pulses), so every per-frame join/sort lives up here
  // on its actual deps and the closure only reads.
  // Attention (frame.attention → employee): the attention actor draws right
  // after the selected one, so both always win a name-label slot.
  const attentionEmployeeId =
    frame.attention?.target === 'employee' ? (frame.attention.employeeId ?? null) : null;
  // employeeId → typed resource strain for the six-kind marker glyphs.
  const resourceKindByEmployee = useMemo(
    () => new Map(frame.resources.map((res) => [res.employeeId, res.resourceKind])),
    [frame.resources],
  );
  const zoneById = useMemo(() => new Map(zoneDefs.map((zone) => [zone.id, zone])), [zoneDefs]);
  // The selected employee draws first so its name label always wins a slot.
  const orderedRoster = useMemo(() => {
    if (selectedEmployeeId == null && attentionEmployeeId == null) return roster;
    const labelPriority = (id: string) =>
      id === selectedEmployeeId ? 0 : id === attentionEmployeeId ? 1 : 2;
    return [...roster].sort((a, b) => labelPriority(a.id) - labelPriority(b.id));
  }, [roster, selectedEmployeeId, attentionEmployeeId]);
  // Purpose-distinct anchor targets: a lane only draws when its employee has a
  // seat, so gating on the same membership keeps this set identical to what
  // the flow pass paints.
  const activeFlowTargets = useMemo(() => {
    const targets = new Set<FlowCueTarget>();
    for (const cue of frame.flows) {
      if (positions.has(cue.employeeId)) targets.add(cue.target);
    }
    return [...targets].sort();
  }, [frame.flows, positions]);

  // Reduced motion freezes the packet animation and the shelf arrival glow
  // while every lane/label/anchor/marker keeps rendering statically.
  const reducedMotion = usePrefersReducedMotion();
  const companionAtlas = useMemo(() => {
    if (!companionAtlasUrl) return null;
    const image = new Image();
    image.src = companionAtlasUrl;
    return image;
  }, [companionAtlasUrl]);
  const [companionAtlasReady, setCompanionAtlasReady] = useState(false);
  const companionActorPositions = useMemo(
    () =>
      new Map(
        [...positions.entries()].map(([employeeId, position]) => [
          employeeId,
          { x: position.x, z: position.z },
        ]),
      ),
    [positions],
  );
  const companionOccupied = useMemo(
    () => officeCompanionOccupiedPoints(frame, companionActorPositions, OFFICE_DELIVERY_WORLD),
    [companionActorPositions, frame],
  );
  const companionCandidates = useMemo(
    () => buildOfficeCompanionCandidates(zoneDefs, companionOccupied, pathfinder),
    [companionOccupied, pathfinder, zoneDefs],
  );
  const companionSpatialRevision = useMemo(
    () =>
      officeCompanionSpatialRevision(
        companionCandidates,
        companionOccupied,
        companionActorPositions,
      ),
    [companionActorPositions, companionCandidates, companionOccupied],
  );
  const companionPlanRef = useRef<OfficeCompanionPlan | null>(null);
  const companionAnimationRef = useRef<{ state: string | null; startedAt: number }>({
    state: null,
    startedAt: 0,
  });
  const companionAnimationWakeRef = useRef<number | null>(null);

  // Artifact arrival (I5): a short-lived shelf glow when recentCount increases.
  // Refs only — the draw effect below keeps a bounded RAF alive while the glow
  // is armed (pulsing flows share the same loop). Seeded with the mount count
  // so pre-existing claims never glow.
  const prevRecentCountRef = useRef(frame.delivery.recentCount);
  const shelfGlowUntilRef = useRef(0);
  useEffect(() => {
    const previous = prevRecentCountRef.current;
    prevRecentCountRef.current = frame.delivery.recentCount;
    if (frame.delivery.recentCount > previous) shelfGlowUntilRef.current = Date.now() + 1600;
  }, [frame.delivery.recentCount]);

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
      syncOfficeCanvasBackingStore(canvas, cw, ch, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
      ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.name;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 10;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.shadowBlur = 0;
      ctx.shadowColor = OFFICE_SCENE_2D_COLORS.transparent;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.font = CANVAS_FONT_TOKENS.canvasReset;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      ctx.clearRect(0, 0, cw, ch);

      const pad = 48;
      const scale = Math.min((cw - pad * 2) / floorW, (ch - pad * 2) / floorD);
      const ox = cw / 2;
      const oy = ch / 2;
      const wx = (x: number) => ox + x * scale;
      const wy = (z: number) => oy + z * scale;

      // floor
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
      roundRect(
        ctx,
        wx(-floorW / 2),
        wy(-floorD / 2),
        floorW * scale,
        floorD * scale,
        CANVAS_RADIUS_TOKENS.officeFloor,
      );
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
          CANVAS_RADIUS_TOKENS.zone,
        );
        ctx.fill();
        if (!pip) {
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
          const title = zone.label.toUpperCase();
          const titleX = wx(zone.cx - zone.w / 2) + 10;
          const titleY = wy(zone.cz - zone.d / 2) + 18;
          ctx.fillText(title, titleX, titleY);
          const titleW = ctx.measureText(title).width;
          occupied.push({
            x0: titleX - 2,
            x1: titleX + titleW + 2,
            y0: titleY - 10,
            y1: titleY + 4,
          });
        }
      }

      // employees — real roster, seated by the shared layout helper
      hitsRef.current = [];
      // Proportional to the floor scale with bounds, never a hard floor: a
      // fixed px minimum decouples from the world-unit seat spacing/edge
      // margins and overflows zone rects on narrow stages.
      const r = Math.min(16, Math.max(9, scale * 0.42));
      // The operational-state ring draws at r + 5; selection is the outer ring.
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
            return { sx: wx(OFFICE_DELIVERY_WORLD.x), sy: wy(OFFICE_DELIVERY_WORLD.z) };
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

      // Width-aware ellipsis for canvas text (lane labels, delivery chips) —
      // the PRD's no-text-overflow rule at draw resolution.
      const ellipsizeToWidth = (text: string, maxWidth: number): string => {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let out = text;
        while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth)
          out = out.slice(0, -1);
        return `${out}…`;
      };

      // Flow layer: bundled cues from the frame — one line per (actor, target,
      // kind). The shared bundleEmphasis rule adds the heavier stroke for
      // bundled (≥2) cues on top of this scene's risk-aware base, capped at
      // 3px. Each lane carries the shared flowCueText density label (`×N ·
      // label` for bundles) on a backing pill at the curve midpoint.
      // Same (employee, target) lanes share identical curve geometry (kinds
      // differ) — stack their labels instead of painting them onto each other.
      const laneLabelSlots = new Map<string, number>();
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
        // Packet param: frozen under reduced motion (static position keeps
        // the information). Uniform source→target for EVERY kind: join cues
        // are attributed to the completing CHILD employee, so source→target
        // already reads as consolidation (child → review); reversing fan-in
        // would animate review → child, backwards.
        const t = reducedMotion || !cue.pulse ? 0.35 : ((Date.now() - cue.at) % 1400) / 1400;
        const px = (1 - t) ** 2 * source.sx + 2 * (1 - t) * t * mx + t ** 2 * target.sx;
        const py = (1 - t) ** 2 * source.sy + 2 * (1 - t) * t * my + t ** 2 * target.sy;
        ctx.fillStyle = ink.packet;
        ctx.beginPath();
        ctx.arc(px, py, cue.ink === 'risk' ? 4.2 : 3.4, 0, Math.PI * 2);
        ctx.fill();
        if (!pip) {
          // Lane density label — flowCueText on a subtle backing pill at the
          // curve midpoint (registered in `occupied` so name labels dodge it).
          ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
          const laneKey = `${cue.employeeId}|${cue.target}`;
          const slot = laneLabelSlots.get(laneKey) ?? 0;
          laneLabelSlots.set(laneKey, slot + 1);
          const text = ellipsizeToWidth(flowCueText(cue), 132);
          const textW = ctx.measureText(text).width;
          const lx = 0.25 * source.sx + 0.5 * mx + 0.25 * target.sx;
          const ly = 0.25 * source.sy + 0.5 * my + 0.25 * target.sy + slot * 17;
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
          roundRect(ctx, lx - textW / 2 - 5, ly - 8, textW + 10, 15, CANVAS_RADIUS_TOKENS.label);
          ctx.fill();
          ctx.fillStyle = ink.packet;
          ctx.textAlign = 'center';
          ctx.fillText(text, lx, ly + 3.5);
          ctx.textAlign = 'left';
          occupied.push({
            x0: lx - textW / 2 - 5,
            x1: lx + textW / 2 + 5,
            y0: ly - 8,
            y1: ly + 7,
          });
        }
        ctx.restore();
      }

      // Purpose-distinct target anchors: a tiny labeled node at every target a
      // live lane points at, so lanes visibly go SOMEWHERE. Dense HUD style —
      // neutral node + micro label; the delivery shelf itself is the delivery
      // anchor whenever it renders.
      for (const anchorTarget of activeFlowTargets) {
        if (anchorTarget === 'delivery' && frame.delivery.latest) continue;
        const anchor = flowTarget(anchorTarget);
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.neutralPacket;
        ctx.beginPath();
        ctx.arc(anchor.sx, anchor.sy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        const anchorText = FLOW_TARGET_LABELS[anchorTarget].toUpperCase();
        const anchorW = ctx.measureText(anchorText).width;
        const ax = anchor.sx;
        const ay = anchor.sy + 15;
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
        roundRect(ctx, ax - anchorW / 2 - 4, ay - 8, anchorW + 8, 14, CANVAS_RADIUS_TOKENS.label);
        ctx.fill();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
        ctx.textAlign = 'center';
        ctx.fillText(anchorText, ax, ay + 3);
        ctx.textAlign = 'left';
        occupied.push({
          x0: ax - anchorW / 2 - 4,
          x1: ax + anchorW / 2 + 4,
          y0: anchor.sy - 4,
          y1: ay + 6,
        });
      }

      // Delivery shelf (I5) — a claimable output surface: DELIVERY header with
      // the ×N running total, up to 3 compact claimable chips (kind tag +
      // ellipsized title, newest emphasized), and a +N overflow tag routed to
      // history/drilldown through the body hit. Grows upward from a fixed
      // bottom edge so it stays on the floor. With no live claim there is no
      // shelf and no hit.
      if (frame.delivery.latest) {
        const shelf = flowTarget('delivery');
        const chips = frame.delivery.chips;
        const shelfW = 132;
        const headH = 18;
        const chipH = 15;
        const chipGap = 3;
        const overflowH = frame.delivery.overflowCount > 0 ? 14 : 0;
        const shelfH = headH + chips.length * (chipH + chipGap) + overflowH + 6;
        const x0 = shelf.sx - shelfW / 2;
        const y1 = shelf.sy + 17; // fixed bottom edge (the old box's bottom)
        const y0 = y1 - shelfH;
        const attentionShelf = frame.attention?.target === 'delivery';
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
        roundRect(ctx, x0, y0, shelfW, shelfH, CANVAS_RADIUS_TOKENS.deliveryShelf);
        ctx.fill();
        // Attention (frame.attention → delivery): a gentle artifact-ink border.
        ctx.strokeStyle = attentionShelf
          ? OFFICE_SCENE_2D_COLORS.artifactLine
          : OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
        ctx.lineWidth = attentionShelf ? 1.6 : 1;
        ctx.stroke();
        ctx.lineWidth = 1;
        // Arrival glow: a short-lived ring after recentCount increases, faded
        // by remaining time. The draw effect keeps a bounded RAF running until
        // glowUntil passes (shared with the pulsing-flow loop when one is
        // active); reduced motion skips it — the chip + ×N carry the
        // information statically.
        const glowLeft = shelfGlowUntilRef.current - Date.now();
        if (!reducedMotion && glowLeft > 0) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, glowLeft / 1600);
          ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
          ctx.lineWidth = 2.5;
          roundRect(
            ctx,
            x0 - 2.5,
            y0 - 2.5,
            shelfW + 5,
            shelfH + 5,
            CANVAS_RADIUS_TOKENS.deliveryShelfGlow,
          );
          ctx.stroke();
          ctx.restore();
        }
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
        ctx.fillText('DELIVERY', x0 + 8, y0 + 13);
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
        ctx.textAlign = 'right';
        ctx.fillText(`×${frame.delivery.recentCount}`, x0 + shelfW - 8, y0 + 13);
        ctx.textAlign = 'left';
        // Body hit first, chips after — the reverse-order hit walk resolves a
        // chip click before the body (history/drilldown) click.
        hitsRef.current.push({ kind: 'delivery', x0, y0, x1: x0 + shelfW, y1 });
        let chipY = y0 + headH + 1;
        chips.forEach((chip, chipIndex) => {
          const newest = chipIndex === chips.length - 1;
          const cx0 = x0 + 6;
          const cw = shelfW - 12;
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
          roundRect(ctx, cx0, chipY, cw, chipH, CANVAS_RADIUS_TOKENS.chip);
          ctx.fill();
          ctx.strokeStyle = newest
            ? OFFICE_SCENE_2D_COLORS.artifactPacket
            : OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
          ctx.stroke();
          // Kind glyph tag + ellipsized title (never overflows the chip).
          ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
          const kindTag = chip.kind.slice(0, 3).toUpperCase();
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
          ctx.fillText(kindTag, cx0 + 5, chipY + 10.5);
          const kindW = ctx.measureText(kindTag).width;
          ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
          ctx.fillStyle = newest ? OFFICE_SCENE_2D_COLORS.name : OFFICE_SCENE_2D_COLORS.zoneLabel;
          const titleX = cx0 + 5 + kindW + 5;
          ctx.fillText(ellipsizeToWidth(chip.title, cx0 + cw - 5 - titleX), titleX, chipY + 11.5);
          hitsRef.current.push({
            kind: 'delivery-chip',
            chipIndex,
            x0: cx0,
            y0: chipY,
            x1: cx0 + cw,
            y1: chipY + chipH,
          });
          chipY += chipH + chipGap;
        });
        // Overflow tag — +N routes to history/drilldown via the body hit.
        if (frame.delivery.overflowCount > 0) {
          ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
          ctx.textAlign = 'center';
          ctx.fillText(`+${frame.delivery.overflowCount} MORE`, shelf.sx, chipY + 9);
          ctx.textAlign = 'left';
        }
        // Register the shelf footprint so employee name labels dodge it.
        occupied.push({ x0, x1: x0 + shelfW, y0, y1 });
      }

      // Ambient-only companion: one pure company/project projection shared
      // with 3D. It never enters hitsRef, employee ordering, or runtime state.
      if (
        companionEnabled &&
        companionAtlasReady &&
        companionAtlas?.naturalWidth === CODEX_PET_ATLAS.width &&
        companionAtlas.naturalHeight === CODEX_PET_ATLAS.height
      ) {
        const nowMs = Date.now();
        const input = {
          enabled: companionEnabled,
          companyId,
          projectId,
          nowMs,
          mode: officeMode,
          reducedMotion,
          geometryRevision: routeSignature,
          frame,
          candidates: companionCandidates,
          occupiedPoints: companionOccupied,
          actorPositions: companionActorPositions,
          spatialRevision: companionSpatialRevision,
          deliveryPoint: OFFICE_DELIVERY_WORLD,
          pathfinder,
        } as const;
        const key = officeCompanionPlanKey(input);
        let plan = companionPlanRef.current;
        if (plan?.key !== key) {
          plan = createOfficeCompanionPlan(input);
          companionPlanRef.current = plan;
        }
        const companion = sampleOfficeCompanionPlan(plan, nowMs);
        if (companion.visible) {
          let atlasFrame = codexPetAtlasFrame(
            companion,
            nowMs,
            companionAnimationRef.current.startedAt,
            reducedMotion,
          );
          if (companionAnimationRef.current.state !== atlasFrame.state) {
            companionAnimationRef.current = { state: atlasFrame.state, startedAt: nowMs };
            atlasFrame = codexPetAtlasFrame(companion, nowMs, nowMs, reducedMotion);
          }
          companionAnimationWakeRef.current = atlasFrame.nextFrameAt;
          const height = Math.min(68, Math.max(34, scale * 1.95));
          const width = height * (CODEX_PET_ATLAS.cellWidth / CODEX_PET_ATLAS.cellHeight);
          const sx = wx(companion.x);
          const sy = wy(companion.z);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(sx, sy);
          ctx.drawImage(
            companionAtlas,
            atlasFrame.column * CODEX_PET_ATLAS.cellWidth,
            atlasFrame.row * CODEX_PET_ATLAS.cellHeight,
            CODEX_PET_ATLAS.cellWidth,
            CODEX_PET_ATLAS.cellHeight,
            -width / 2,
            -height,
            width,
            height,
          );
          ctx.restore();
        } else {
          companionAnimationWakeRef.current = null;
          companionAnimationRef.current = { state: null, startedAt: 0 };
        }
      } else {
        companionPlanRef.current = null;
        companionAnimationWakeRef.current = null;
        companionAnimationRef.current = { state: null, startedAt: 0 };
      }

      for (const employee of orderedRoster) {
        const pos = positions.get(employee.id);
        if (!pos) continue;
        const cue = actorById.get(employee.id);
        const selected = cue?.selected ?? false;
        const wl = cue?.workload ?? null;
        const status = cue?.status ?? 'idle';
        const blocked = status === 'blocked';
        const colors = resolveAppearance(employee.id, employee.appearance);
        const screen = screenForEmployee(employee.id);
        if (!screen) continue;
        const { sx, sy } = screen;

        // desk — below ~14px/unit it is no longer legible as furniture
        if (scale >= 14) {
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.desk;
          roundRect(ctx, sx - r * 1.1, sy + r * 0.5, r * 2.2, r * 0.9, CANVAS_RADIUS_TOKENS.desk);
          ctx.fill();
        }

        // Shared P4 operational state: geometry remains the existing 2D ring,
        // but classification and exact ink come only from ActorCue.status.
        if (status !== 'idle') {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle =
            status === 'working'
              ? OFFICE_SCENE_2D_COLORS.stateWorking
              : status === 'approval'
                ? OFFICE_SCENE_2D_COLORS.stateApproval
                : OFFICE_SCENE_2D_COLORS.stateBlocked;
          ctx.lineWidth = status === 'blocked' ? 2 : 2.4;
          if (status === 'blocked') ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Selection is an orthogonal, single outer ring and never replaces or
        // recolours the business-state ring.
        if (selected) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 9, 0, Math.PI * 2);
          ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.stateSelected;
          ctx.lineWidth = 1.8;
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
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.neutralPacket;
          ctx.fillText(wl.countLabel, bx, by);
          ctx.textAlign = 'left';
          occupied.push({ x0: bx - 9, x1: bx + 9, y0: by - 9, y1: by + 5 });
        }

        // Resource marker: only a typed T/B/P/C/R/X strain may occupy this
        // rounded-square slot. Approval is the amber operational ring; a
        // kindless failure is confirmed by the generic blocked status marker.
        const topIssue = wl?.topIssue ?? null;
        const strainKind = resourceKindByEmployee.get(employee.id) ?? null;
        if (topIssue && topIssue.kind !== 'approval' && strainKind) {
          const mx = blocked ? sx + r + 5 : sx - r - 5;
          const my = sy - r - 4;
          const glyph = RESOURCE_KIND_GLYPHS[strainKind];
          const filled = topIssue.severity !== 'warning';
          const markerColor = officeResourceMarkerColor(topIssue.severity);
          if (filled) {
            ctx.fillStyle = markerColor;
            roundRect(ctx, mx - 6, my - 6, 12, 12, CANVAS_RADIUS_TOKENS.resourceMarker);
            ctx.fill();
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
          } else {
            ctx.strokeStyle = markerColor;
            ctx.lineWidth = 1.4;
            roundRect(ctx, mx - 6, my - 6, 12, 12, CANVAS_RADIUS_TOKENS.resourceMarker);
            ctx.stroke();
            ctx.fillStyle = markerColor;
          }
          ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
          ctx.textAlign = 'center';
          ctx.fillText(glyph, mx, my + 3);
          ctx.textAlign = 'left';
        } else if (blocked) {
          const mx = sx + r + 5;
          const my = sy - r - 4;
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.stateBlocked;
          roundRect(ctx, mx - 5, my - 5, 10, 10, CANVAS_RADIUS_TOKENS.blockedMarker);
          ctx.fill();
        }

        // Chip row — the bubble is capped to fixed dimensions. small keeps the
        // 3-char per-run look; medium/large draw grouped chips with their count
        // ("Blocked 3", "Research 24") in pills widened to the measured text so
        // the count is never clipped. The cue already caps chips at 4.
        if (!pip && wl && wl.chips.length > 0) {
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
            roundRect(ctx, cx, cyTop, cell.w, chipH, CANVAS_RADIUS_TOKENS.chip);
            ctx.fill();
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
            ctx.fillText(cell.text, cx + cell.w / 2, cy + 4);
            cx += cell.w + gap;
          }
          // Overflow affordance — a compact "+more" pill that opens the same
          // read-only drilldown as the bubble region.
          if (wl.overflow) {
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
            roundRect(ctx, cx, cyTop, overflowW, chipH, CANVAS_RADIUS_TOKENS.chip);
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
        if (hoveredEmployeeId === employee.id) {
          const employeeSeniority = seniorityForEmployee(seniority.data, employee.id);
          if (employeeSeniority) {
            const career = employeeSeniorityLabel(employeeSeniority);
            ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
            const careerW = ctx.measureText(career).width + 14;
            const careerH = 20;
            const careerX = sx - careerW / 2;
            const careerY = sy - r - 42;
            roundRect(
              ctx,
              careerX,
              careerY,
              careerW,
              careerH,
              CANVAS_RADIUS_TOKENS.deliveryShelf,
            );
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
            ctx.fill();
            ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.activeRing;
            ctx.stroke();
            ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
            ctx.textAlign = 'center';
            ctx.fillText(career, sx, careerY + 14);
            ctx.textAlign = 'left';
          }
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

        hitsRef.current.push({
          kind: 'employee',
          employeeId: employee.id,
          threadId: cue?.threadId ?? null,
          sx,
          sy,
          r: r + 6,
        });
      }
    };
  });

  useEffect(() => {
    setCompanionAtlasReady(false);
    if (!companionAtlas) return;
    if (
      companionAtlas.complete &&
      companionAtlas.naturalWidth === CODEX_PET_ATLAS.width &&
      companionAtlas.naturalHeight === CODEX_PET_ATLAS.height
    ) {
      setCompanionAtlasReady(true);
      drawRef.current();
      return;
    }
    const redraw = () =>
      setCompanionAtlasReady(
        companionAtlas.naturalWidth === CODEX_PET_ATLAS.width &&
          companionAtlas.naturalHeight === CODEX_PET_ATLAS.height,
      );
    companionAtlas.addEventListener('load', redraw, { once: true });
    return () => companionAtlas.removeEventListener('load', redraw);
  }, [companionAtlas]);

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
  // loop keeps the packet animation moving. An armed arrival glow keeps the
  // loop alive on its own when no flow pulses — bounded by glowUntil (≤1.6s),
  // so the glow can never freeze mid-fade — and the loop stops itself once
  // both animations are done. Reduced motion never loops — everything renders
  // once, statically (and the glow is skipped entirely).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the atlas/store/mode values intentionally invalidate this timer loop even though the live draw closure reads them through drawRef.
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    const hasPulsingFlow = !reducedMotion && frame.flows.some((cue) => cue.pulse);
    const glowActive = () => !reducedMotion && shelfGlowUntilRef.current > Date.now();
    const tick = () => {
      drawRef.current();
      if (hasPulsingFlow || glowActive()) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      const companionPlan = companionPlanRef.current;
      const animationWakeAt = companionAnimationWakeRef.current;
      if (!companionPlan?.nextWakeAt && !animationWakeAt) return;
      const delay =
        companionPlan && !companionPlan.static
          ? 84
          : Math.max(
              16,
              Math.min(
                companionPlan?.nextWakeAt ?? Number.POSITIVE_INFINITY,
                animationWakeAt ?? Number.POSITIVE_INFINITY,
              ) - Date.now(),
            );
      timer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(tick);
      }, delay);
    };
    tick();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [
    companionAtlasReady,
    companionEnabled,
    frame,
    hoveredEmployeeId,
    officeMode,
    reducedMotion,
    seniority.data,
  ]);

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
        setHoveredEmployeeId(hit?.kind === 'employee' ? hit.employeeId : null);
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
          if (hit.threadId) openThread(hit.threadId);
          return;
        }
        if (hit.kind === 'drilldown') {
          if (hit.employeeId) openWorkloadDrilldown(hit.employeeId);
          return;
        }
        // delivery chip — open exactly THAT claim on the stage (carries
        // threadId so the output surface loads in-thread, like the 3D shelf).
        if (hit.kind === 'delivery-chip') {
          const chip = frame.delivery.chips[hit.chipIndex ?? -1];
          if (chip) void openArtifactClaim(chip, { openStageView, projectId });
          return;
        }
        // delivery body / +N overflow — the shared history route (owner
        // drilldown via the claim's projection-stamped employeeId, else open
        // the claim itself).
        openDeliveryHistory(frame.delivery.latest, {
          openWorkloadDrilldown,
          openStageView,
          projectId,
        });
      }}
    />
  );
}
