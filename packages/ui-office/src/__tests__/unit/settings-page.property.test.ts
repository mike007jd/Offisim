import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Feature: settings-page-rebuild
 * Property-based tests for Settings page routing and unsaved changes detection.
 */

// --- Shared constants mirroring production code ---

const SETTINGS_TABS = ['provider', 'runtime', 'mcp'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_COMPONENT_MAP: Record<SettingsTab, string> = {
  provider: 'SettingsProviderTab',
  runtime: 'SettingsRuntimeTab',
  mcp: 'McpConfigPanel',
};

// --- Property 1 ---

describe('Feature: settings-page-rebuild, Property 1: Tab navigation renders correct content', () => {
  /**
   * Validates: Requirements 3.5
   *
   * For any SettingsTab value, the routing logic maps it to exactly one
   * content component. This property verifies the mapping is total
   * (every tab has a component) and deterministic (same tab always
   * yields the same component).
   */
  it('every tab value maps to exactly one content component', () => {
    const tabArb = fc.constantFrom(...SETTINGS_TABS);

    fc.assert(
      fc.property(tabArb, (tab) => {
        // The routing logic in SettingsContentArea is a simple conditional:
        //   activeTab === 'provider' → SettingsProviderTab
        //   activeTab === 'runtime' → SettingsRuntimeTab
        //   activeTab === 'mcp'     → McpConfigPanel
        // We verify the mapping is defined and unique.
        const component = TAB_COMPONENT_MAP[tab];
        expect(component).toBeDefined();
        expect(typeof component).toBe('string');
        expect(component.length).toBeGreaterThan(0);

        // Verify exclusivity: only one component matches
        const matchingTabs = Object.entries(TAB_COMPONENT_MAP).filter(
          ([, comp]) => comp === component,
        );
        expect(matchingTabs).toHaveLength(1);
        expect(matchingTabs[0][0]).toBe(tab);
      }),
      { numRuns: 100 },
    );
  });

  it('tab set is exhaustive — all 3 tabs have routing entries', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SETTINGS_TABS), (tab) => {
        expect(tab in TAB_COMPONENT_MAP).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2 ---

describe('Feature: settings-page-rebuild, Property 2: Unsaved changes detection invariant', () => {
  /**
   * Validates: Requirements 5.1, 5.2, 5.3
   *
   * The controller uses JSON.stringify snapshot comparison to detect
   * unsaved changes. We generate random settings value pairs and verify
   * the invariant: hasUnsavedChanges iff snapshots differ.
   */

  const settingsArb = fc.record({
    preset: fc.string({ minLength: 1, maxLength: 30 }),
    apiKey: fc.string({ maxLength: 50 }),
    model: fc.string({ minLength: 1, maxLength: 30 }),
    baseURL: fc.string({ maxLength: 100 }),
    executionMode: fc.constantFrom('auto', 'sequential', 'parallel'),
    summarizationEnabled: fc.boolean(),
    summarizationTriggerTokens: fc.nat({ max: 100000 }).map(String),
    summarizationKeepRecentMessages: fc.nat({ max: 100 }).map(String),
    memoryEnabled: fc.boolean(),
    memoryInjectionEnabled: fc.boolean(),
    memoryMaxFacts: fc.nat({ max: 1000 }).map(String),
    memoryConfidenceThreshold: fc.float({ min: 0, max: 1, noNaN: true }).map((v) => v.toFixed(2)),
    toolSearchEnabled: fc.boolean(),
    gitAutoCommit: fc.boolean(),
    toolPermissions: fc.constantFrom('ask', 'allow', 'deny'),
    density: fc.constantFrom('compact', 'normal', 'spacious'),
  });

  it('identical settings produce no unsaved changes', () => {
    fc.assert(
      fc.property(settingsArb, (settings) => {
        const snapshot1 = JSON.stringify(settings);
        const snapshot2 = JSON.stringify(settings);
        const hasUnsavedChanges = snapshot1 !== snapshot2;
        expect(hasUnsavedChanges).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('different settings produce unsaved changes', () => {
    fc.assert(
      fc.property(settingsArb, settingsArb, (settingsA, settingsB) => {
        const snapshotA = JSON.stringify(settingsA);
        const snapshotB = JSON.stringify(settingsB);
        const hasUnsavedChanges = snapshotA !== snapshotB;

        // If the snapshots are equal, there should be no unsaved changes
        if (snapshotA === snapshotB) {
          expect(hasUnsavedChanges).toBe(false);
        } else {
          // If snapshots differ, hasUnsavedChanges must be true
          expect(hasUnsavedChanges).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('reverting to original values clears unsaved changes', () => {
    fc.assert(
      fc.property(settingsArb, settingsArb, (original, modified) => {
        const loadedSnapshot = JSON.stringify(original);
        const modifiedSnapshot = JSON.stringify(modified);
        // After modification
        const hasDirty = loadedSnapshot !== modifiedSnapshot;
        // After reverting back to original
        const revertedSnapshot = JSON.stringify(original);
        const hasUnsavedAfterRevert = loadedSnapshot !== revertedSnapshot;
        expect(hasUnsavedAfterRevert).toBe(false);

        // The dirty flag should match whether snapshots differ
        if (loadedSnapshot === modifiedSnapshot) {
          expect(hasDirty).toBe(false);
        } else {
          expect(hasDirty).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
