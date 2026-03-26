import type { InstallState } from '@aics/shared-types';
import { describe, expect, it } from 'vitest';
import {
  TRANSITIONS,
  isErrorState,
  isTerminalState,
  validateTransition,
} from '../state-machine.js';

function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe('state-machine', () => {
  // -----------------------------------------------------------------------
  // Happy path: full forward chain
  // -----------------------------------------------------------------------
  describe('happy path forward chain', () => {
    const happyPath: InstallState[] = [
      'created',
      'manifest_loaded',
      'integrity_checked',
      'compatibility_checked',
      'dependency_planned',
      'ready_to_install',
      'materializing',
      'installed',
    ];

    it('allows the complete happy-path chain created -> ... -> installed', () => {
      for (let i = 0; i < happyPath.length - 1; i++) {
        const from = requireDefined(happyPath[i], `Missing state at index ${i}`);
        const to = requireDefined(happyPath[i + 1], `Missing state at index ${i + 1}`);
        const result = validateTransition(from, to);
        expect(result.valid, `${from} -> ${to} should be valid`).toBe(true);
      }
    });

    it('allows the confirmation/bindings branch', () => {
      expect(validateTransition('dependency_planned', 'awaiting_confirmation').valid).toBe(true);
      expect(validateTransition('awaiting_confirmation', 'awaiting_bindings').valid).toBe(true);
      expect(validateTransition('awaiting_bindings', 'ready_to_install').valid).toBe(true);
    });

    it('allows skipping confirmation but going through bindings', () => {
      expect(validateTransition('dependency_planned', 'awaiting_bindings').valid).toBe(true);
    });

    it('allows skipping both confirmation and bindings', () => {
      expect(validateTransition('dependency_planned', 'ready_to_install').valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Error branches
  // -----------------------------------------------------------------------
  describe('error branches', () => {
    const statesThatCanFail: InstallState[] = [
      'created',
      'manifest_loaded',
      'integrity_checked',
      'compatibility_checked',
      'dependency_planned',
      'materializing',
    ];

    it.each(statesThatCanFail)('%s -> failed is valid', (state) => {
      expect(validateTransition(state, 'failed').valid).toBe(true);
    });

    it('awaiting_confirmation -> cancelled is valid', () => {
      expect(validateTransition('awaiting_confirmation', 'cancelled').valid).toBe(true);
    });

    it('materializing -> rolled_back is valid', () => {
      expect(validateTransition('materializing', 'rolled_back').valid).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Illegal transitions
  // -----------------------------------------------------------------------
  describe('illegal transitions', () => {
    it('rejects backward transitions', () => {
      const result = validateTransition('integrity_checked', 'manifest_loaded');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('rejects skipping multiple steps', () => {
      const result = validateTransition('created', 'installed');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid state pairs', () => {
      const result = validateTransition('awaiting_bindings', 'cancelled');
      expect(result.valid).toBe(false);
    });

    it('rejects transition from awaiting_confirmation to failed', () => {
      // awaiting_confirmation can only go to awaiting_bindings, ready_to_install, or cancelled
      const result = validateTransition('awaiting_confirmation', 'failed');
      expect(result.valid).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Terminal state immutability
  // -----------------------------------------------------------------------
  describe('terminal states', () => {
    const terminals: InstallState[] = ['installed', 'failed', 'rolled_back', 'cancelled'];

    it.each(terminals)('%s is terminal', (state) => {
      expect(isTerminalState(state)).toBe(true);
    });

    it.each(terminals)('cannot transition from %s to any state', (state) => {
      const targets: InstallState[] = [
        'created',
        'manifest_loaded',
        'integrity_checked',
        'compatibility_checked',
        'dependency_planned',
        'awaiting_confirmation',
        'awaiting_bindings',
        'ready_to_install',
        'materializing',
        'installed',
        'failed',
        'rolled_back',
        'cancelled',
      ];
      for (const to of targets) {
        const result = validateTransition(state, to);
        expect(result.valid, `${state} -> ${to} should be invalid`).toBe(false);
        expect(result.reason).toContain('terminal');
      }
    });
  });

  // -----------------------------------------------------------------------
  // isErrorState
  // -----------------------------------------------------------------------
  describe('isErrorState', () => {
    it('returns true for failed', () => expect(isErrorState('failed')).toBe(true));
    it('returns true for rolled_back', () => expect(isErrorState('rolled_back')).toBe(true));
    it('returns false for cancelled', () => expect(isErrorState('cancelled')).toBe(false));
    it('returns false for installed', () => expect(isErrorState('installed')).toBe(false));
    it('returns false for non-terminal states', () => {
      expect(isErrorState('created')).toBe(false);
      expect(isErrorState('materializing')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // TRANSITIONS map completeness
  // -----------------------------------------------------------------------
  describe('TRANSITIONS map', () => {
    it('has entries for all non-terminal states', () => {
      const nonTerminals: InstallState[] = [
        'created',
        'manifest_loaded',
        'integrity_checked',
        'compatibility_checked',
        'dependency_planned',
        'awaiting_confirmation',
        'awaiting_bindings',
        'ready_to_install',
        'materializing',
      ];
      for (const state of nonTerminals) {
        expect(TRANSITIONS.has(state), `Missing transitions for ${state}`).toBe(true);
      }
    });

    it('has no entries for terminal states', () => {
      expect(TRANSITIONS.has('installed')).toBe(false);
      expect(TRANSITIONS.has('failed')).toBe(false);
      expect(TRANSITIONS.has('rolled_back')).toBe(false);
      expect(TRANSITIONS.has('cancelled')).toBe(false);
    });
  });
});
