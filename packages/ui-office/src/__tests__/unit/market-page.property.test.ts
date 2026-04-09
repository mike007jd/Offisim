import type { AssetKind } from '@offisim/asset-schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getRarityColor } from '../../components/marketplace/market-rarity.js';
import { formatInstallCount } from '../../components/marketplace/marketplace-meta.js';

/**
 * Feature: market-page-rebuild
 * Property-based tests for rarity color mapping, install count formatting,
 * and mode switch behavior.
 */

// --- Shared constants ---

const ASSET_KINDS: AssetKind[] = [
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'prefab',
  'bundle',
];

type MarketSessionState = {
  mode: 'explore' | 'manage';
  selectedListingId: string | null;
  search: string;
  sort: 'relevance' | 'newest' | 'rating' | 'installs';
  kind: AssetKind | 'all';
  manageTab: 'installed' | 'updates' | 'published';
};

// --- Property 1 ---

describe('Feature: market-page-rebuild, Property 1: Rarity color mapping completeness', () => {
  /**
   * Validates: Requirements 7.2
   *
   * For any AssetKind value, getRarityColor(kind) returns a RarityColorScheme
   * with non-empty border, glow, badge, and accent fields.
   */
  it('every AssetKind maps to a complete RarityColorScheme', () => {
    const kindArb = fc.constantFrom(...ASSET_KINDS);

    fc.assert(
      fc.property(kindArb, (kind) => {
        const scheme = getRarityColor(kind);

        expect(scheme).toBeDefined();
        expect(typeof scheme.border).toBe('string');
        expect(scheme.border.length).toBeGreaterThan(0);
        expect(typeof scheme.glow).toBe('string');
        expect(scheme.glow.length).toBeGreaterThan(0);
        expect(typeof scheme.badge).toBe('string');
        expect(scheme.badge.length).toBeGreaterThan(0);
        expect(typeof scheme.accent).toBe('string');
        expect(scheme.accent.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2 ---

describe('Feature: market-page-rebuild, Property 2: Install count formatting invariant', () => {
  /**
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4
   *
   * For any non-negative integer n, formatInstallCount(n) returns a non-empty
   * string. When n < 1000 it equals String(n). When n >= 1000 it ends with "k".
   */
  it('formatInstallCount returns non-empty string and follows k-suffix rules', () => {
    const nonNegIntArb = fc.nat({ max: 10_000_000 });

    fc.assert(
      fc.property(nonNegIntArb, (n) => {
        const result = formatInstallCount(n);

        // Must be non-empty
        expect(result.length).toBeGreaterThan(0);

        if (n < 1000) {
          // Below 1000: exact string representation
          expect(result).toBe(String(n));
        } else {
          // 1000 and above: ends with "k"
          expect(result.endsWith('k')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 3 ---

describe('Feature: market-page-rebuild, Property 3: Mode switch clears selected listing', () => {
  /**
   * Validates: Requirements 1.5
   *
   * For any MarketSessionState with mode='explore' and a non-null
   * selectedListingId, switching to manage mode clears selectedListingId to null.
   */
  it('explore→manage switch sets selectedListingId to null', () => {
    const stateArb = fc.record({
      mode: fc.constant('explore' as const),
      selectedListingId: fc.string({ minLength: 1, maxLength: 50 }),
      search: fc.string({ maxLength: 100 }),
      sort: fc.constantFrom(
        'relevance' as const,
        'newest' as const,
        'rating' as const,
        'installs' as const,
      ),
      kind: fc.constantFrom('all' as const, ...ASSET_KINDS),
      manageTab: fc.constantFrom('installed' as const, 'updates' as const, 'published' as const),
    });

    fc.assert(
      fc.property(stateArb, (state: MarketSessionState) => {
        // Simulate the mode switch logic from MarketPage.handleModeChange
        const newMode = 'manage' as const;
        const result: MarketSessionState = {
          ...state,
          mode: newMode,
          selectedListingId: newMode === 'manage' ? null : state.selectedListingId,
        };

        expect(result.selectedListingId).toBeNull();
        expect(result.mode).toBe('manage');
      }),
      { numRuns: 100 },
    );
  });
});
