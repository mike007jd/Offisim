import { describe, expect, it } from 'vitest';

import { computeLayoutTier } from './types';

// ---------------------------------------------------------------------------
// computeLayoutTier — unit tests
// ---------------------------------------------------------------------------
// Validates Requirements 13.1, 13.2, 13.3, 13.6
// The function is pure and deterministic: same width → same tier.
// ---------------------------------------------------------------------------

describe('computeLayoutTier', () => {
  // ---- Narrow tier (≤768) ------------------------------------------------

  it('returns narrow tier for width 0', () => {
    const result = computeLayoutTier(0);
    expect(result.tier).toBe('narrow');
    expect(result.leftRailDefault).toBe('collapsed');
    expect(result.rightRailDefault).toBe('collapsed');
    expect(result.workspaceLayout).toBe('stacked-navigation');
  });

  it('returns narrow tier for width 768 (upper boundary)', () => {
    const result = computeLayoutTier(768);
    expect(result.tier).toBe('narrow');
  });

  it('returns narrow tier for width 1', () => {
    expect(computeLayoutTier(1).tier).toBe('narrow');
  });

  // ---- Tablet tier (769–1280) --------------------------------------------

  it('returns tablet tier for width 769 (lower boundary)', () => {
    const result = computeLayoutTier(769);
    expect(result.tier).toBe('tablet');
    expect(result.leftRailDefault).toBe('visible');
    expect(result.rightRailDefault).toBe('collapsed');
    expect(result.workspaceLayout).toBe('two-pane-collapsible');
  });

  it('returns tablet tier for width 1280 (upper boundary)', () => {
    const result = computeLayoutTier(1280);
    expect(result.tier).toBe('tablet');
  });

  it('returns tablet tier for width 1024 (mid-range)', () => {
    expect(computeLayoutTier(1024).tier).toBe('tablet');
  });

  // ---- Desktop tier (>1280) ----------------------------------------------

  it('returns desktop tier for width 1281 (lower boundary)', () => {
    const result = computeLayoutTier(1281);
    expect(result.tier).toBe('desktop');
    expect(result.leftRailDefault).toBe('visible');
    expect(result.rightRailDefault).toBe('visible');
    expect(result.workspaceLayout).toBe('three-pane');
  });

  it('returns desktop tier for width 1920', () => {
    expect(computeLayoutTier(1920).tier).toBe('desktop');
  });

  it('returns desktop tier for width 3840 (4K)', () => {
    expect(computeLayoutTier(3840).tier).toBe('desktop');
  });

  // ---- Determinism -------------------------------------------------------

  it('is deterministic: same input always produces same output', () => {
    const a = computeLayoutTier(1024);
    const b = computeLayoutTier(1024);
    expect(a).toEqual(b);
  });

  // ---- Full config shape -------------------------------------------------

  it('narrow config has correct full shape', () => {
    expect(computeLayoutTier(500)).toEqual({
      tier: 'narrow',
      leftRailDefault: 'collapsed',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'stacked-navigation',
    });
  });

  it('tablet config has correct full shape', () => {
    expect(computeLayoutTier(1000)).toEqual({
      tier: 'tablet',
      leftRailDefault: 'visible',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'two-pane-collapsible',
    });
  });

  it('desktop config has correct full shape', () => {
    expect(computeLayoutTier(1600)).toEqual({
      tier: 'desktop',
      leftRailDefault: 'visible',
      rightRailDefault: 'visible',
      workspaceLayout: 'three-pane',
    });
  });
});
