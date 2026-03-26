import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_STATE_SIGNALS,
  SIGNAL_PRIORITY_ORDER,
  type StateSignal,
  resolveCompetingSignals,
} from '../tokens/state-feedback-matrix.js';

const ALL_STATES = [
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
] as const;

describe('state-feedback-matrix', () => {
  it('defines signal arrays for all 12 employee states', () => {
    for (const state of ALL_STATES) {
      const signals = EMPLOYEE_STATE_SIGNALS[state];
      expect(signals, `missing signals for state "${state}"`).toBeDefined();
      expect(Array.isArray(signals)).toBe(true);
      expect(signals?.length).toBeGreaterThan(0);
    }
  });

  it('every signal has a valid type and priority', () => {
    const validTypes = new Set([
      'ring_color',
      'ring_pulse',
      'badge',
      'bubble',
      'route_line',
      'room_glow',
      'ambient_dim',
    ]);
    const validPriorities = new Set(['critical', 'high', 'medium', 'low', 'ambient']);

    for (const state of ALL_STATES) {
      const signals = EMPLOYEE_STATE_SIGNALS[state];
      expect(signals, `missing signals for state "${state}"`).toBeDefined();
      if (!signals) continue;

      for (const signal of signals) {
        expect(
          validTypes.has(signal.type),
          `invalid type "${signal.type}" in state "${state}"`,
        ).toBe(true);
        expect(
          validPriorities.has(signal.priority),
          `invalid priority "${signal.priority}" in state "${state}"`,
        ).toBe(true);
        expect(signal.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every state includes ring_color as its first signal', () => {
    for (const state of ALL_STATES) {
      const first = EMPLOYEE_STATE_SIGNALS[state]?.[0];
      expect(first?.type, `state "${state}" first signal should be ring_color`).toBe('ring_color');
    }
  });

  it('blocked and failed have critical priority', () => {
    for (const state of ['blocked', 'failed'] as const) {
      const signals = EMPLOYEE_STATE_SIGNALS[state];
      expect(signals, `missing signals for state "${state}"`).toBeDefined();
      if (!signals) continue;

      const hasCritical = signals.some((s) => s.priority === 'critical');
      expect(hasCritical, `state "${state}" should have at least one critical signal`).toBe(true);
    }
  });

  it('success and failed have finite durations or zero for persistent signals', () => {
    const successSignals = EMPLOYEE_STATE_SIGNALS.success;
    expect(successSignals).toBeDefined();
    if (!successSignals) return;

    const hasTimedSignal = successSignals.some((s) => s.durationMs > 0);
    expect(hasTimedSignal).toBe(true);
  });
});

describe('SIGNAL_PRIORITY_ORDER', () => {
  it('critical > high > medium > low > ambient', () => {
    expect(SIGNAL_PRIORITY_ORDER.critical).toBeGreaterThan(SIGNAL_PRIORITY_ORDER.high);
    expect(SIGNAL_PRIORITY_ORDER.high).toBeGreaterThan(SIGNAL_PRIORITY_ORDER.medium);
    expect(SIGNAL_PRIORITY_ORDER.medium).toBeGreaterThan(SIGNAL_PRIORITY_ORDER.low);
    expect(SIGNAL_PRIORITY_ORDER.low).toBeGreaterThan(SIGNAL_PRIORITY_ORDER.ambient);
  });
});

describe('resolveCompetingSignals', () => {
  it('picks highest priority signal per type', () => {
    const signals: StateSignal[] = [
      { type: 'ring_color', priority: 'low', durationMs: 0 },
      { type: 'ring_color', priority: 'critical', durationMs: 0 },
      { type: 'badge', priority: 'medium', durationMs: 0, config: { icon: 'search' } },
    ];

    const resolved = resolveCompetingSignals(signals);
    expect(resolved).toHaveLength(2);

    const ringSignal = resolved.find((s) => s.type === 'ring_color');
    expect(ringSignal?.priority).toBe('critical');

    const badgeSignal = resolved.find((s) => s.type === 'badge');
    expect(badgeSignal?.priority).toBe('medium');
  });

  it('returns single signal when no conflicts', () => {
    const signals: StateSignal[] = [{ type: 'ring_color', priority: 'ambient', durationMs: 0 }];

    const resolved = resolveCompetingSignals(signals);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.priority).toBe('ambient');
  });

  it('handles multiple types with same priority', () => {
    const signals: StateSignal[] = [
      { type: 'ring_color', priority: 'high', durationMs: 0 },
      { type: 'ring_pulse', priority: 'high', durationMs: 0 },
      { type: 'badge', priority: 'high', durationMs: 0 },
    ];

    const resolved = resolveCompetingSignals(signals);
    expect(resolved).toHaveLength(3);
  });

  it('resolves competing signals from different employee states', () => {
    // Simulate merging signals from "blocked" (critical) and "thinking" (medium)
    const blocked = EMPLOYEE_STATE_SIGNALS.blocked;
    const thinking = EMPLOYEE_STATE_SIGNALS.thinking;
    expect(blocked).toBeDefined();
    expect(thinking).toBeDefined();
    if (!blocked || !thinking) return;

    const combined = [...blocked, ...thinking];

    const resolved = resolveCompetingSignals(combined);

    // ring_color should be critical (from blocked), not medium (from thinking)
    const ringColor = resolved.find((s) => s.type === 'ring_color');
    expect(ringColor?.priority).toBe('critical');

    // ring_pulse should also be critical (from blocked)
    const ringPulse = resolved.find((s) => s.type === 'ring_pulse');
    expect(ringPulse?.priority).toBe('critical');

    // badge should be critical (from blocked, alert icon)
    const badge = resolved.find((s) => s.type === 'badge');
    expect(badge?.priority).toBe('critical');
  });

  it('returns empty array for empty input', () => {
    expect(resolveCompetingSignals([])).toHaveLength(0);
  });
});
