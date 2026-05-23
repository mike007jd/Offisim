import * as THREE from 'three';

export type FaceExpression = 'neutral' | 'focus' | 'happy' | 'worried' | 'blink';

const FACE_TEX_SIZE = 128;

const FACE_PALETTE = {
  ink: '#1f2937', // raw-hex-allowed: face decal ink
  blush: '#f4a48b', // raw-hex-allowed: cheek tone
  eyeColor: '#1b2436', // raw-hex-allowed: iris ink
} as const;

const cache = new Map<FaceExpression, THREE.CanvasTexture>();

function draw(ctx: CanvasRenderingContext2D, expression: FaceExpression) {
  const w = FACE_TEX_SIZE;
  const h = FACE_TEX_SIZE;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = FACE_PALETTE.ink;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = FACE_PALETTE.ink;

  // Cheeks (subtle blush)
  ctx.fillStyle = FACE_PALETTE.blush;
  ctx.globalAlpha = expression === 'happy' ? 0.7 : 0.4;
  ctx.beginPath();
  ctx.arc(w * 0.28, h * 0.62, 8, 0, Math.PI * 2);
  ctx.arc(w * 0.72, h * 0.62, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Eyebrows shape per expression
  ctx.strokeStyle = FACE_PALETTE.ink;
  ctx.lineWidth = 3;
  const browYL = h * 0.34;
  const browYR = h * 0.34;
  if (expression === 'focus') {
    ctx.beginPath();
    ctx.moveTo(w * 0.28, browYL + 2);
    ctx.lineTo(w * 0.4, browYL - 2);
    ctx.moveTo(w * 0.6, browYR - 2);
    ctx.lineTo(w * 0.72, browYR + 2);
    ctx.stroke();
  } else if (expression === 'worried') {
    ctx.beginPath();
    ctx.moveTo(w * 0.28, browYL + 3);
    ctx.lineTo(w * 0.4, browYL - 4);
    ctx.moveTo(w * 0.6, browYR - 4);
    ctx.lineTo(w * 0.72, browYR + 3);
    ctx.stroke();
  } else if (expression === 'happy') {
    ctx.beginPath();
    ctx.moveTo(w * 0.28, browYL + 1);
    ctx.quadraticCurveTo(w * 0.34, browYL - 5, w * 0.4, browYL + 1);
    ctx.moveTo(w * 0.6, browYR + 1);
    ctx.quadraticCurveTo(w * 0.66, browYR - 5, w * 0.72, browYR + 1);
    ctx.stroke();
  }

  // Eyes
  ctx.fillStyle = FACE_PALETTE.eyeColor;
  if (expression === 'blink') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.48);
    ctx.lineTo(w * 0.4, h * 0.48);
    ctx.moveTo(w * 0.6, h * 0.48);
    ctx.lineTo(w * 0.7, h * 0.48);
    ctx.stroke();
  } else if (expression === 'happy') {
    // curved happy eyes ^^
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.3, h * 0.5);
    ctx.quadraticCurveTo(w * 0.35, h * 0.44, w * 0.4, h * 0.5);
    ctx.moveTo(w * 0.6, h * 0.5);
    ctx.quadraticCurveTo(w * 0.65, h * 0.44, w * 0.7, h * 0.5);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.5, 4, 0, Math.PI * 2);
    ctx.arc(w * 0.65, h * 0.5, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth
  ctx.lineWidth = 3;
  ctx.strokeStyle = FACE_PALETTE.ink;
  ctx.beginPath();
  if (expression === 'happy') {
    ctx.moveTo(w * 0.42, h * 0.72);
    ctx.quadraticCurveTo(w * 0.5, h * 0.8, w * 0.58, h * 0.72);
  } else if (expression === 'worried') {
    ctx.moveTo(w * 0.42, h * 0.78);
    ctx.quadraticCurveTo(w * 0.5, h * 0.72, w * 0.58, h * 0.78);
  } else if (expression === 'focus') {
    ctx.moveTo(w * 0.45, h * 0.76);
    ctx.lineTo(w * 0.55, h * 0.76);
  } else {
    // neutral / blink: gentle curve
    ctx.moveTo(w * 0.44, h * 0.74);
    ctx.quadraticCurveTo(w * 0.5, h * 0.77, w * 0.56, h * 0.74);
  }
  ctx.stroke();
}

function makeFaceTexture(expression: FaceExpression): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = FACE_TEX_SIZE;
  canvas.height = FACE_TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, expression);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function getFaceTexture(expression: FaceExpression): THREE.CanvasTexture | null {
  let tex = cache.get(expression);
  if (tex) return tex;
  const built = makeFaceTexture(expression);
  if (!built) return null;
  tex = built;
  cache.set(expression, tex);
  return tex;
}

export function disposeFaceTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

// HMR: dispose CanvasTextures when this module is replaced so GPU textures
// aren't leaked across hot reloads (CanvasTexture has no finalizer hook).
if (
  typeof import.meta !== 'undefined' &&
  (import.meta as { hot?: { dispose: (fn: () => void) => void } }).hot
) {
  (import.meta as unknown as { hot: { dispose: (fn: () => void) => void } }).hot.dispose(
    disposeFaceTextureCache,
  );
}
