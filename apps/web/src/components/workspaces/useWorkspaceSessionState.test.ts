import { describe, expect, it } from 'vitest';

import type { WorkspaceSessionState } from './types';
import {
  createDefaultSessionState,
  createDefaultSopState,
  createDefaultMarketState,
  createDefaultActivityLogState,
} from './types';
import {
  tryWorkspaceInternalBack,
  hasInternalDrillIn,
  SESSION_KEY,
} from './useWorkspaceSessionState';

// ---------------------------------------------------------------------------
// Helper: build session state with overrides
// ---------------------------------------------------------------------------

function withSops(
  overrides: Partial<WorkspaceSessionState['sops']>,
): WorkspaceSessionState {
  return {
    ...createDefaultSessionState(),
    sops: { ...createDefaultSopState(), ...overrides },
  };
}

function withMarket(
  overrides: Partial<WorkspaceSessionState['market']>,
): WorkspaceSessionState {
  return {
    ...createDefaultSessionState(),
    market: { ...createDefaultMarketState(), ...overrides },
  };
}

function withActivityLog(
  overrides: Partial<WorkspaceSessionState['activityLog']>,
): WorkspaceSessionState {
  return {
    ...createDefaultSessionState(),
    activityLog: { ...createDefaultActivityLogState(), ...overrides },
  };
}

// ---------------------------------------------------------------------------
// SESSION_KEY mapping
// ---------------------------------------------------------------------------

describe('SESSION_KEY mapping', () => {
  it('maps WorkspaceKey to WorkspaceSessionState property keys', () => {
    expect(SESSION_KEY['office']).toBe('office');
    expect(SESSION_KEY['sops']).toBe('sops');
    expect(SESSION_KEY['market']).toBe('market');
    expect(SESSION_KEY['activity-log']).toBe('activityLog');
  });
});

// ---------------------------------------------------------------------------
// hasInternalDrillIn
// ---------------------------------------------------------------------------

describe('hasInternalDrillIn', () => {
  it('returns false for office (no internal drill-in)', () => {
    expect(hasInternalDrillIn('office', createDefaultSessionState())).toBe(false);
  });

  it('returns false for sops at empty center mode', () => {
    expect(hasInternalDrillIn('sops', withSops({ centerMode: 'empty' }))).toBe(false);
  });

  it('returns true for sops at definition center mode', () => {
    expect(hasInternalDrillIn('sops', withSops({ centerMode: 'definition' }))).toBe(true);
  });

  it('returns true for sops at run-focus center mode', () => {
    expect(hasInternalDrillIn('sops', withSops({ centerMode: 'run-focus' }))).toBe(true);
  });

  it('returns false for market in manage mode', () => {
    expect(hasInternalDrillIn('market', withMarket({ mode: 'manage' }))).toBe(false);
  });

  it('returns false for market in explore mode with no listing selected', () => {
    expect(
      hasInternalDrillIn('market', withMarket({ mode: 'explore', selectedListingId: null })),
    ).toBe(false);
  });

  it('returns true for market in explore mode with a listing selected', () => {
    expect(
      hasInternalDrillIn('market', withMarket({ mode: 'explore', selectedListingId: 'l-1' })),
    ).toBe(true);
  });

  it('returns false for activity-log with no event selected', () => {
    expect(
      hasInternalDrillIn('activity-log', withActivityLog({ selectedEventId: null })),
    ).toBe(false);
  });

  it('returns true for activity-log with an event selected', () => {
    expect(
      hasInternalDrillIn('activity-log', withActivityLog({ selectedEventId: 'e-1' })),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tryWorkspaceInternalBack
// ---------------------------------------------------------------------------

describe('tryWorkspaceInternalBack', () => {
  describe('office', () => {
    it('returns not consumed (office has no internal drill-in)', () => {
      const state = createDefaultSessionState();
      const [consumed, next] = tryWorkspaceInternalBack('office', state);
      expect(consumed).toBe(false);
      expect(next).toBe(state); // same reference
    });
  });

  describe('sops', () => {
    it('unwinds run-focus → definition', () => {
      const state = withSops({
        centerMode: 'run-focus',
        selectedSopId: 'sop-1',
      });
      const [consumed, next] = tryWorkspaceInternalBack('sops', state);
      expect(consumed).toBe(true);
      expect(next.sops.centerMode).toBe('definition');
      expect(next.sops.selectedSopId).toBe('sop-1'); // preserved
    });

    it('unwinds definition → empty and clears selectedSopId', () => {
      const state = withSops({
        centerMode: 'definition',
        selectedSopId: 'sop-1',
      });
      const [consumed, next] = tryWorkspaceInternalBack('sops', state);
      expect(consumed).toBe(true);
      expect(next.sops.centerMode).toBe('empty');
      expect(next.sops.selectedSopId).toBeNull();
    });

    it('returns not consumed at empty', () => {
      const state = withSops({ centerMode: 'empty' });
      const [consumed] = tryWorkspaceInternalBack('sops', state);
      expect(consumed).toBe(false);
    });

    it('preserves search during unwind', () => {
      const state = withSops({
        centerMode: 'definition',
        selectedSopId: 'sop-1',
        search: 'onboarding',
      });
      const [, next] = tryWorkspaceInternalBack('sops', state);
      expect(next.sops.search).toBe('onboarding');
    });
  });

  describe('market', () => {
    it('unwinds explore-detail → explore-feed (clears selectedListingId)', () => {
      const state = withMarket({
        mode: 'explore',
        selectedListingId: 'listing-1',
      });
      const [consumed, next] = tryWorkspaceInternalBack('market', state);
      expect(consumed).toBe(true);
      expect(next.market.selectedListingId).toBeNull();
      expect(next.market.mode).toBe('explore'); // preserved
    });

    it('returns not consumed in explore mode with no listing', () => {
      const state = withMarket({ mode: 'explore', selectedListingId: null });
      const [consumed] = tryWorkspaceInternalBack('market', state);
      expect(consumed).toBe(false);
    });

    it('returns not consumed in manage mode', () => {
      const state = withMarket({ mode: 'manage' });
      const [consumed] = tryWorkspaceInternalBack('market', state);
      expect(consumed).toBe(false);
    });

    it('preserves search and kind during unwind', () => {
      const state = withMarket({
        mode: 'explore',
        selectedListingId: 'listing-1',
        search: 'sop template',
        kind: 'employee',
      });
      const [, next] = tryWorkspaceInternalBack('market', state);
      expect(next.market.search).toBe('sop template');
      expect(next.market.kind).toBe('employee');
    });
  });

  describe('activity-log', () => {
    it('unwinds event-focused → timeline (clears selectedEventId)', () => {
      const state = withActivityLog({ selectedEventId: 'evt-1' });
      const [consumed, next] = tryWorkspaceInternalBack('activity-log', state);
      expect(consumed).toBe(true);
      expect(next.activityLog.selectedEventId).toBeNull();
    });

    it('returns not consumed with no event selected', () => {
      const state = withActivityLog({ selectedEventId: null });
      const [consumed] = tryWorkspaceInternalBack('activity-log', state);
      expect(consumed).toBe(false);
    });

    it('preserves filters during unwind', () => {
      const state = withActivityLog({
        selectedEventId: 'evt-1',
        eventTypes: ['sop-run'],
        actorFilters: ['emp-1'],
        datePreset: '7d',
      });
      const [, next] = tryWorkspaceInternalBack('activity-log', state);
      expect(next.activityLog.eventTypes).toEqual(['sop-run']);
      expect(next.activityLog.actorFilters).toEqual(['emp-1']);
      expect(next.activityLog.datePreset).toBe('7d');
    });
  });
});

// ---------------------------------------------------------------------------
// Immutability: state updates produce new objects
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('tryWorkspaceInternalBack produces a new state object when consumed', () => {
    const state = withSops({ centerMode: 'definition', selectedSopId: 'sop-1' });
    const [consumed, next] = tryWorkspaceInternalBack('sops', state);
    expect(consumed).toBe(true);
    expect(next).not.toBe(state);
    expect(next.sops).not.toBe(state.sops);
    // Other workspace states should be the same reference
    expect(next.office).toBe(state.office);
    expect(next.market).toBe(state.market);
    expect(next.activityLog).toBe(state.activityLog);
  });

  it('tryWorkspaceInternalBack returns same reference when not consumed', () => {
    const state = withSops({ centerMode: 'empty' });
    const [consumed, next] = tryWorkspaceInternalBack('sops', state);
    expect(consumed).toBe(false);
    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Studio containment — pure state transition tests (Req 5.1, 5.2, 5.3, 5.4)
// ---------------------------------------------------------------------------

describe('Studio containment state rules', () => {
  it('studioMode is null in default Office session state', () => {
    const state = createDefaultSessionState();
    expect(state.office.studioMode).toBeNull();
  });

  it('switching away from Office with active studioMode should nullify it (Req 5.2)', () => {
    const state: WorkspaceSessionState = {
      ...createDefaultSessionState(),
      office: {
        viewMode: '2D',
        selectedEmployeeId: 'emp-42',
        studioMode: 'edit',
      },
    };

    // Simulate what setActiveWorkspace does: close Studio when leaving Office
    const nextState: WorkspaceSessionState = {
      ...state,
      office: { ...state.office, studioMode: null },
    };

    expect(nextState.office.studioMode).toBeNull();
    // viewMode and selectedEmployeeId preserved (Req 5.4)
    expect(nextState.office.viewMode).toBe('2D');
    expect(nextState.office.selectedEmployeeId).toBe('emp-42');
  });
});
