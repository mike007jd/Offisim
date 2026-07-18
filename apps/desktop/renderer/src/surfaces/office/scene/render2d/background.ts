import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';

export interface OccupiedRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface EmployeeHit {
  kind: 'employee';
  employeeId: string;
  threadId: string | null;
  sx: number;
  sy: number;
  r: number;
}

export interface RectHit {
  kind: 'drilldown' | 'delivery' | 'delivery-chip';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  employeeId?: string;
  chipIndex?: number;
}

export type Hit = EmployeeHit | RectHit;

interface CanvasBackingStore {
  width: number;
  height: number;
  style: { width: string; height: string };
}

export interface Render2DSurface {
  readonly ctx: CanvasRenderingContext2D;
  readonly cw: number;
  readonly ch: number;
  readonly scale: number;
  readonly wx: (x: number) => number;
  readonly wy: (z: number) => number;
}

export interface OfficeCanvasViewport {
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

export function projectOfficeCanvasViewport(
  host: { readonly left: number; readonly height: number },
  widthOwner: { readonly left: number; readonly width: number },
): OfficeCanvasViewport {
  return {
    x: widthOwner.left - host.left,
    width: widthOwner.width,
    height: host.height,
  };
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

export function roundRect(
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

export function drawBackground(
  canvas: HTMLCanvasElement,
  floorW: number,
  floorD: number,
): Render2DSurface | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const parent = canvas.parentElement;
  if (!parent) return null;
  const widthOwner = canvas.closest<HTMLElement>('.off-office-center');
  if (!widthOwner) return null;
  const dpr = window.devicePixelRatio || 1;
  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  syncOfficeCanvasBackingStore(canvas, cw, ch, dpr);
  const viewport = projectOfficeCanvasViewport(
    { left: parent.getBoundingClientRect().left, height: ch },
    { left: widthOwner.getBoundingClientRect().left, width: widthOwner.clientWidth },
  );
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
  const scale = Math.min((viewport.width - pad * 2) / floorW, (viewport.height - pad * 2) / floorD);
  const ox = viewport.x + viewport.width / 2;
  const oy = viewport.height / 2;
  const wx = (x: number) => ox + x * scale;
  const wy = (z: number) => oy + z * scale;

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

  return { ctx, cw, ch, scale, wx, wy };
}
