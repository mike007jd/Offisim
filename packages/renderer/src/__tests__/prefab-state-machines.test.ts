import type { EmployeeState, SemanticCategory } from '@aics/shared-types';
import { describe, expect, it } from 'vitest';
import {
  COLLABORATION_TRANSITIONS,
  COMPUTE_TRANSITIONS,
  INFRASTRUCTURE_TRANSITIONS,
  KNOWLEDGE_TRANSITIONS,
  WORKSPACE_TRANSITIONS,
  canTransition,
  getAllStates,
  getInitialState,
  inferWorkspaceState,
} from '../prefab/state-machines.js';

// ── Transition table structure ──────────────────────────────────

describe('transition tables', () => {
  it('WORKSPACE_TRANSITIONS has 7 states', () => {
    expect(Object.keys(WORKSPACE_TRANSITIONS)).toHaveLength(7);
  });

  it('COMPUTE_TRANSITIONS has 5 states', () => {
    expect(Object.keys(COMPUTE_TRANSITIONS)).toHaveLength(5);
  });

  it('KNOWLEDGE_TRANSITIONS has 6 states', () => {
    expect(Object.keys(KNOWLEDGE_TRANSITIONS)).toHaveLength(6);
  });

  it('COLLABORATION_TRANSITIONS has 6 states', () => {
    expect(Object.keys(COLLABORATION_TRANSITIONS)).toHaveLength(6);
  });

  it('INFRASTRUCTURE_TRANSITIONS has 5 states', () => {
    expect(Object.keys(INFRASTRUCTURE_TRANSITIONS)).toHaveLength(5);
  });

  it('all transition targets reference valid states within the same table', () => {
    const tables = [
      WORKSPACE_TRANSITIONS,
      COMPUTE_TRANSITIONS,
      KNOWLEDGE_TRANSITIONS,
      COLLABORATION_TRANSITIONS,
      INFRASTRUCTURE_TRANSITIONS,
    ];
    for (const table of tables) {
      const validStates = new Set(Object.keys(table));
      for (const [from, targets] of Object.entries(table)) {
        for (const to of targets) {
          expect(
            validStates.has(to),
            `"${from}" -> "${to}" references non-existent state in table`,
          ).toBe(true);
        }
      }
    }
  });

  it('no state lists itself as a valid transition target', () => {
    const tables = [
      WORKSPACE_TRANSITIONS,
      COMPUTE_TRANSITIONS,
      KNOWLEDGE_TRANSITIONS,
      COLLABORATION_TRANSITIONS,
      INFRASTRUCTURE_TRANSITIONS,
    ];
    for (const table of tables) {
      for (const [from, targets] of Object.entries(table)) {
        expect(targets.includes(from), `"${from}" should not transition to itself`).toBe(false);
      }
    }
  });
});

// ── getInitialState ─────────────────────────────────────────────

describe('getInitialState', () => {
  const cases: [SemanticCategory, string | null][] = [
    ['workspace', 'empty'],
    ['compute', 'offline'],
    ['knowledge', 'empty'],
    ['collaboration', 'empty'],
    ['infrastructure', 'disconnected'],
    ['decorative', null],
  ];

  it.each(cases)('returns %j for category "%s"', (category, expected) => {
    expect(getInitialState(category)).toBe(expected);
  });
});

// ── getAllStates ─────────────────────────────────────────────────

describe('getAllStates', () => {
  const counts: [SemanticCategory, number][] = [
    ['workspace', 7],
    ['compute', 5],
    ['knowledge', 6],
    ['collaboration', 6],
    ['infrastructure', 5],
    ['decorative', 0],
  ];

  it.each(counts)('returns %d states for category "%s"', (category, count) => {
    const states = getAllStates(category);
    expect(states).toHaveLength(count);
  });

  it('returns distinct values (no duplicates)', () => {
    const categories: SemanticCategory[] = [
      'workspace',
      'compute',
      'knowledge',
      'collaboration',
      'infrastructure',
    ];
    for (const cat of categories) {
      const states = getAllStates(cat);
      expect(new Set(states).size).toBe(states.length);
    }
  });
});

// ── canTransition ───────────────────────────────────────────────

describe('canTransition', () => {
  describe('workspace', () => {
    it('allows empty -> occupied', () => {
      expect(canTransition('workspace', 'empty', 'occupied')).toBe(true);
    });

    it('disallows empty -> working (must go through occupied)', () => {
      expect(canTransition('workspace', 'empty', 'working')).toBe(false);
    });

    it('allows idle -> empty (release desk)', () => {
      expect(canTransition('workspace', 'idle', 'empty')).toBe(true);
    });

    it('disallows working -> empty (must go through idle or occupied)', () => {
      expect(canTransition('workspace', 'working', 'empty')).toBe(false);
    });
  });

  describe('compute', () => {
    it('allows offline -> idle (boot)', () => {
      expect(canTransition('compute', 'offline', 'idle')).toBe(true);
    });

    it('allows processing -> overloaded', () => {
      expect(canTransition('compute', 'processing', 'overloaded')).toBe(true);
    });

    it('disallows offline -> processing (must boot first)', () => {
      expect(canTransition('compute', 'offline', 'processing')).toBe(false);
    });
  });

  describe('knowledge', () => {
    it('allows stocked -> indexing', () => {
      expect(canTransition('knowledge', 'stocked', 'indexing')).toBe(true);
    });

    it('allows ready -> searching', () => {
      expect(canTransition('knowledge', 'ready', 'searching')).toBe(true);
    });

    it('disallows empty -> ready (must stock and index first)', () => {
      expect(canTransition('knowledge', 'empty', 'ready')).toBe(false);
    });
  });

  describe('collaboration', () => {
    it('allows scheduled -> gathering', () => {
      expect(canTransition('collaboration', 'scheduled', 'gathering')).toBe(true);
    });

    it('allows active -> paused', () => {
      expect(canTransition('collaboration', 'active', 'paused')).toBe(true);
    });

    it('disallows ended -> active (meeting over)', () => {
      expect(canTransition('collaboration', 'ended', 'active')).toBe(false);
    });
  });

  describe('infrastructure', () => {
    it('allows idle -> transmitting', () => {
      expect(canTransition('infrastructure', 'idle', 'transmitting')).toBe(true);
    });

    it('allows transmitting -> congested', () => {
      expect(canTransition('infrastructure', 'transmitting', 'congested')).toBe(true);
    });

    it('disallows disconnected -> transmitting (must connect first)', () => {
      expect(canTransition('infrastructure', 'disconnected', 'transmitting')).toBe(false);
    });
  });

  describe('decorative', () => {
    it('always returns false (no state machine)', () => {
      expect(canTransition('decorative', 'any', 'other')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for unknown from state', () => {
      expect(canTransition('workspace', 'nonexistent', 'idle')).toBe(false);
    });

    it('returns false for unknown to state', () => {
      expect(canTransition('workspace', 'idle', 'nonexistent')).toBe(false);
    });

    it('returns false for self-transition', () => {
      expect(canTransition('workspace', 'idle', 'idle')).toBe(false);
    });
  });
});

// ── inferWorkspaceState ─────────────────────────────────────────

describe('inferWorkspaceState', () => {
  const mappings: [EmployeeState, string][] = [
    ['idle', 'idle'],
    ['assigned', 'occupied'],
    ['thinking', 'thinking'],
    ['searching', 'searching'],
    ['executing', 'working'],
    ['meeting', 'idle'],
    ['blocked', 'blocked'],
    ['waiting', 'occupied'],
    ['reporting', 'working'],
    ['success', 'idle'],
    ['failed', 'blocked'],
    ['paused', 'idle'],
  ];

  it.each(mappings)(
    'maps EmployeeState "%s" to workspace state "%s"',
    (employeeState, expected) => {
      expect(inferWorkspaceState(employeeState)).toBe(expected);
    },
  );

  it('covers all 12 EmployeeState values', () => {
    expect(mappings).toHaveLength(12);
    const allEmployeeStates: EmployeeState[] = [
      'idle',
      'assigned',
      'thinking',
      'searching',
      'executing',
      'meeting',
      'blocked',
      'waiting',
      'reporting',
      'success',
      'failed',
      'paused',
    ];
    for (const state of allEmployeeStates) {
      const result = inferWorkspaceState(state);
      expect(result, `inferWorkspaceState("${state}") should return a string`).toBeTruthy();
    }
  });

  it('always returns a valid WorkspacePrefabState', () => {
    const validWorkspaceStates = new Set(Object.keys(WORKSPACE_TRANSITIONS));
    const allEmployeeStates: EmployeeState[] = [
      'idle',
      'assigned',
      'thinking',
      'searching',
      'executing',
      'meeting',
      'blocked',
      'waiting',
      'reporting',
      'success',
      'failed',
      'paused',
    ];
    for (const state of allEmployeeStates) {
      const result = inferWorkspaceState(state);
      expect(
        validWorkspaceStates.has(result),
        `inferWorkspaceState("${state}") returned "${result}" which is not a valid workspace state`,
      ).toBe(true);
    }
  });
});
