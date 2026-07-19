// @offisim/prefab — pure logic: prefab catalog, state machines, default
// layouts. No rendering engine dependency (PixiJS removed; 3D = Three.js,
// 2D = SVG).
//
// (H/C1) The legacy `tokens/` subtree (colors / motion / state-feedback /
// departments) was dropped: no consumer outside this package imports those
// symbols. If you bring back any of them, re-export from here and update the
// package-level compatibility notes.

// Prefab system — catalog, state machines, event router, default layouts
export * from './prefab/index.js';
