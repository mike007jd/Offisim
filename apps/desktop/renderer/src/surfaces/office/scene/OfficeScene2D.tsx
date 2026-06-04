import { useUiState } from '@/app/ui-state.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { useEmployees, useOfficeScene, useThreads } from '@/data/queries.js';
import type { ZoneKind } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { CANVAS_FONT_TOKENS } from '@/styles/visual-tokens.js';
import { useEffect, useMemo, useRef } from 'react';
import { compactSceneEmployeeName } from './scene-labels.js';

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
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const scene = useOfficeScene();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const layout = scene.data;
  const threadList = threads.data;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const liveThread = threadList?.find((t) => t.runState === 'running');

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
      const scale = Math.min((cw - pad * 2) / layout.floorW, (ch - pad * 2) / layout.floorD);
      const ox = cw / 2;
      const oy = ch / 2;
      const wx = (x: number) => ox + x * scale;
      const wy = (z: number) => oy + z * scale;

      // floor
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
      roundRect(
        ctx,
        wx(-layout.floorW / 2),
        wy(-layout.floorD / 2),
        layout.floorW * scale,
        layout.floorD * scale,
        14,
      );
      ctx.fill();
      ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.floorLine;
      ctx.stroke();

      // grid
      ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.grid;
      ctx.lineWidth = 1;
      for (let gx = -layout.floorW / 2; gx <= layout.floorW / 2; gx += 1) {
        ctx.beginPath();
        ctx.moveTo(wx(gx), wy(-layout.floorD / 2));
        ctx.lineTo(wx(gx), wy(layout.floorD / 2));
        ctx.stroke();
      }
      for (let gz = -layout.floorD / 2; gz <= layout.floorD / 2; gz += 1) {
        ctx.beginPath();
        ctx.moveTo(wx(-layout.floorW / 2), wy(gz));
        ctx.lineTo(wx(layout.floorW / 2), wy(gz));
        ctx.stroke();
      }

      // zones
      ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
      for (const zone of layout.zones) {
        ctx.fillStyle = ZONE_TINT[zone.kind];
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
        ctx.fillText(
          zone.label.toUpperCase(),
          wx(zone.cx - zone.w / 2) + 10,
          wy(zone.cz - zone.d / 2) + 18,
        );
      }

      // employees
      hitsRef.current = [];
      const r = Math.max(16, scale * 0.42);
      for (const placement of layout.placements) {
        const employee = byId.get(placement.employeeId);
        if (!employee) continue;
        const thread = threadList?.find((t) => t.employeeId === employee.id);
        const running =
          thread?.runState === 'running' || (liveThread?.scope === 'team' && employee.online);
        const active = Boolean(thread && thread.id === selectedThreadId);
        const colors = resolveAppearance(employee.id, employee.appearance);
        const sx = wx(placement.x);
        const sy = wy(placement.z);

        // desk
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.desk;
        roundRect(ctx, sx - r * 1.1, sy + r * 0.5, r * 2.2, r * 0.9, 4);
        ctx.fill();

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

        // name
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        ctx.textAlign = 'center';
        ctx.fillText(compactSceneEmployeeName(employee.name), sx, sy + r + 18);
        ctx.textAlign = 'left';

        if (thread) hitsRef.current.push({ threadId: thread.id, sx, sy, r: r + 6 });
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [layout, threadList, byId, selectedThreadId]);

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
