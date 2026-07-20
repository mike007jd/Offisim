import type { BrowserSessionBounds } from '@/lib/tauri-commands.js';

/**
 * Ownership contract for native child WebView surfaces (Browser today, any
 * future native stage surface): the native layer renders above the main
 * WebView, so CSS z-index cannot order it against app UI. Instead the renderer
 * computes the host element's *visible* bounds — the host DOMRect intersected
 * with the app viewport — in Tauri logical coordinates (CSS pixels; never
 * rescaled by the display pixel ratio) and hides the native surface whenever the
 * host has no visible area or an application overlay must appear above it.
 */

export interface NativeSurfaceRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NativeSurfaceViewport {
  width: number;
  height: number;
}

/**
 * Radix portal surfaces (popovers, menus, dialogs) mount under this wrapper as
 * direct children of document.body. Any of them intersecting a native host
 * must appear above the native surface, which is impossible while it is shown.
 */
export const NATIVE_SURFACE_OVERLAY_SELECTOR = '[data-radix-popper-content-wrapper]';

/**
 * Host rect ∩ app viewport → rounded logical bounds, or null when no visible
 * area remains. Null means "hide the native surface"; zero-size bounds are
 * never sent to Rust (BrowserSessionBounds requires a positive size).
 */
export function computeVisibleNativeBounds(
  rect: NativeSurfaceRect,
  viewport: NativeSurfaceViewport,
): BrowserSessionBounds | null {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewport.width);
  const bottom = Math.min(rect.bottom, viewport.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Rounded-bounds equality: a difference of at least 1px in any field. */
export function sameNativeBounds(
  a: BrowserSessionBounds | null,
  b: BrowserSessionBounds | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function rectsIntersect(a: NativeSurfaceRect, b: NativeSurfaceRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** True when any application overlay rect intersects the native host rect. */
export function anyOverlayIntersectsHost(
  hostRect: NativeSurfaceRect,
  overlayRects: readonly NativeSurfaceRect[],
): boolean {
  return overlayRects.some(
    (overlay) =>
      overlay.right - overlay.left >= 1 &&
      overlay.bottom - overlay.top >= 1 &&
      rectsIntersect(hostRect, overlay),
  );
}
