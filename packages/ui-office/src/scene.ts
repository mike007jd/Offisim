/**
 * Subpath entry for PixiJS-dependent scene components.
 * Import from '@aics/ui-office/scene' to enable lazy loading —
 * this keeps the heavy PixiJS + GSAP vendor chunks out of the initial bundle.
 */
export { SceneCanvas } from './components/scene/SceneCanvas.js';
export { useScene } from './components/scene/useScene.js';
