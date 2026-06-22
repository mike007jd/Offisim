import { useUiState } from '@/app/ui-state.js';
import {
  dominantBeatsFrom,
  useEmployeeWorkloads,
} from '@/assistant/runtime/conversation-run-react.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { useEmployees, useOfficeLayout, useThreads } from '@/data/queries.js';
import type { ZoneKind } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { CANVAS_FONT_TOKENS } from '@/styles/visual-tokens.js';
import {
  type StagingPrefab,
  applyDramaturgyMode,
  projectOfficeStaging,
} from '@offisim/shared-types';
import { useEffect, useMemo, useRef } from 'react';
import { SCENE_CONTENT_SCALE } from './r3d/scene-art-direction.js';
import { compactSceneEmployeeName } from './scene-labels.js';
import {
  archetypeToKind,
  clamp,
  defaultEmployeeZone,
  employeePlacements,
  floorBounds,
  zoneDefsFromLayout,
} from './scene-layout.js';

const ZONE_TINT: Record<ZoneKind, string> = {
  workspace: OFFICE_SCENE_2D_COLORS.zoneWorkspace,
  meeting: OFFICE_SCENE_2D_COLORS.zoneMeeting,
  lounge: OFFICE_SCENE_2D_COLORS.zoneLounge,
};

interface Hit {
  threadId: string;
  sx: number;
  sy: number;
  r: number;
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

export function OfficeScene2D() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const workloads = useEmployeeWorkloads(projectId, companyId);
  // Same real source as the 3D scene — real zones + real roster, with the
  // synthetic fallback only when there is no backend (non-Tauri/dev preview).
  const layout = useOfficeLayout(companyId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);

  // Memoized so positions and the canvas draw effect don't recompute/redraw on
  // every render — `employees.data ?? []` is otherwise a fresh array each time.
  const roster = useMemo(() => employees.data ?? [], [employees.data]);
  const zoneDefs = useMemo(() => zoneDefsFromLayout(layout.data), [layout.data]);
  const { floorW, floorD } = useMemo(() => floorBounds(zoneDefs), [zoneDefs]);
  const fallbackZone = useMemo(() => defaultEmployeeZone(zoneDefs), [zoneDefs]);
  const positions = useMemo(
    () => employeePlacements(roster, zoneDefs, fallbackZone, layout.data?.prefabs),
    [roster, zoneDefs, fallbackZone, layout.data?.prefabs],
  );

  // Same live dramaturgy projection as the 3D scene → high-value movement beats
  // relocate the dot to the reserved world anchor (drawn precisely, no zone
  // clamp). 2D and 3D therefore agree on where each actor is. Staging reads the
  // dominant beat of each employee's dominant ACTIVE run (one per actor), the
  // same workload truth that lights the ring — not a separate latest-wins
  // timeline that could stage a just-finished run over a still-running one.
  const dominantBeats = useMemo(() => dominantBeatsFrom(workloads), [workloads]);
  const officeMode = useUiState((s) => s.officeMode);
  const reducedMotion = usePrefersReducedMotion();
  const stagedById = useMemo(() => {
    const prefabs: StagingPrefab[] = (layout.data?.prefabs ?? []).map((p) => ({
      instanceId: p.instance.instance_id,
      prefabId: p.instance.prefab_id,
      x: p.instance.position_x,
      z: p.instance.position_y,
      rotation: p.instance.rotation,
      // Anchor offsets scale to match the home-seat planner (which scales in both
      // render modes), so a relocated dot sits on the same seat in 2D and 3D.
      scale: SCENE_CONTENT_SCALE,
    }));
    const map = new Map<string, { x: number; z: number }>();
    const staged = applyDramaturgyMode(projectOfficeStaging(dominantBeats, prefabs, positions), {
      mode: officeMode,
      reducedMotion,
    });
    for (const d of staged) {
      if (d.staging?.x != null && d.staging.z != null) {
        map.set(d.employeeId, { x: d.staging.x, z: d.staging.z });
      }
    }
    return map;
  }, [dominantBeats, layout.data?.prefabs, positions, officeMode, reducedMotion]);

  const threadList = threads.data;
  const threadByEmployee = useMemo(() => {
    const map = new Map<string, NonNullable<typeof threadList>[number]>();
    for (const thread of threadList ?? []) {
      if (thread.employeeId && !map.has(thread.employeeId)) map.set(thread.employeeId, thread);
    }
    return map;
  }, [threadList]);
  const selectedEmployeeId = useMemo(
    () => threadList?.find((t) => t.id === selectedThreadId)?.employeeId,
    [selectedThreadId, threadList],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
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
      for (const employee of ordered) {
        const pos = positions.get(employee.id);
        if (!pos) continue;
        const thread = threadByEmployee.get(employee.id);
        const workload = workloads.get(employee.id);
        const activeCount = workload?.activeCount ?? 0;
        const running = activeCount > 0;
        const active = Boolean(thread && thread.id === selectedThreadId);
        const colors = resolveAppearance(employee.id, employee.appearance);
        const staged = stagedById.get(employee.id);
        let sx = wx(staged ? staged.x : pos.x);
        let sy = wy(staged ? staged.z : pos.z);

        // Screen-space re-clamp of the world clampSeat: the world margin only
        // folds to ~margin*scale px, while the painted extent (disc + ring +
        // label slots) is in fixed px, so on small stages seats must be pulled
        // back inside their zone rect here. Relocated actors sit at a precise
        // cross-zone anchor, so they skip the home-zone clamp.
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

        // desk — below ~14px/unit it is no longer legible as furniture
        if (scale >= 14) {
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.desk;
          roundRect(ctx, sx - r * 1.1, sy + r * 0.5, r * 2.2, r * 0.9, 4);
          ctx.fill();
        }

        // running / active ring
        if (running || active) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = running
            ? OFFICE_SCENE_2D_COLORS.activeRing
            : OFFICE_SCENE_2D_COLORS.activeRingSoft;
          ctx.lineWidth = running ? 2.5 : 1.5;
          ctx.stroke();
        }

        // active-count badge — multiple concurrent runs collapse to one actor,
        // so the count (×2, ×3, …) is the only signal of parallel work. Drawn
        // top-right of the disc and registered so name labels dodge it.
        if (activeCount > 1) {
          const bx = sx + r + 3;
          const by = sy - r - 3;
          ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
          ctx.textAlign = 'center';
          ctx.fillStyle = OFFICE_SCENE_2D_COLORS.activeRing;
          ctx.fillText(`×${activeCount}`, bx, by);
          ctx.textAlign = 'left';
          occupied.push({ x0: bx - 9, x1: bx + 9, y0: by - 9, y1: by + 5 });
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

        if (thread) hitsRef.current.push({ threadId: thread.id, sx, sy, r: r + 6 });
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [
    zoneDefs,
    floorW,
    floorD,
    positions,
    stagedById,
    roster,
    threadByEmployee,
    selectedEmployeeId,
    selectedThreadId,
    workloads,
  ]);

  // A zero-zone (empty) office draws the bare floor slab with nobody seated —
  // employeePlacements returns no seats for zero zones; OfficeStage owns the
  // "No office layout yet" overlay for both render modes.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: canvas hit-test is a pointer convenience; employees are keyboard-selectable via the team dock and thread list
    <canvas
      ref={canvasRef}
      className="off-scene-canvas"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const hit = hitsRef.current.find((h) => Math.hypot(px - h.sx, py - h.sy) <= h.r);
        if (hit) openThread(hit.threadId);
      }}
    />
  );
}
