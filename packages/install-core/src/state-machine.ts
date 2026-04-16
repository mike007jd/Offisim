/**
 * Install state machine — transition validation and state classification.
 * This file is the source of truth for the install lifecycle.
 */

import type { InstallState } from '@offisim/shared-types';
import type { TransitionMap, TransitionResult } from './types.js';

// ---------------------------------------------------------------------------
// Transition Map
// ---------------------------------------------------------------------------

/**
 * Canonical transition table.
 *
 * Each entry maps a state to the set of states it may transition to.
 * Terminal states (installed, failed, rolled_back, cancelled) have no outgoing
 * transitions — they are intentionally absent from the map.
 */
export const TRANSITIONS: TransitionMap = new Map<InstallState, ReadonlySet<InstallState>>([
  ['created', new Set<InstallState>(['manifest_loaded', 'failed'])],
  ['manifest_loaded', new Set<InstallState>(['integrity_checked', 'failed'])],
  ['integrity_checked', new Set<InstallState>(['compatibility_checked', 'failed'])],
  ['compatibility_checked', new Set<InstallState>(['dependency_planned', 'failed'])],
  [
    'dependency_planned',
    new Set<InstallState>([
      'awaiting_confirmation',
      'awaiting_bindings',
      'ready_to_install',
      'failed',
    ]),
  ],
  [
    'awaiting_confirmation',
    new Set<InstallState>(['awaiting_bindings', 'ready_to_install', 'cancelled']),
  ],
  ['awaiting_bindings', new Set<InstallState>(['ready_to_install'])],
  ['ready_to_install', new Set<InstallState>(['materializing'])],
  ['materializing', new Set<InstallState>(['installed', 'rolled_back', 'failed'])],
]);

// ---------------------------------------------------------------------------
// Terminal / Error classification
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<InstallState> = new Set<InstallState>([
  'installed',
  'failed',
  'rolled_back',
  'cancelled',
]);

const ERROR_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['failed', 'rolled_back']);

/** Returns true if the given state has no valid outgoing transitions. */
export function isTerminalState(state: InstallState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Returns true if the state represents an error outcome. */
export function isErrorState(state: InstallState): boolean {
  return ERROR_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Transition validation
// ---------------------------------------------------------------------------

/**
 * Validate whether transitioning from `from` to `to` is permitted by the
 * install state machine.
 */
export function validateTransition(from: InstallState, to: InstallState): TransitionResult {
  if (isTerminalState(from)) {
    return {
      valid: false,
      from,
      to,
      reason: `Cannot transition from terminal state '${from}'`,
    };
  }

  const allowed = TRANSITIONS.get(from);
  if (!allowed || !allowed.has(to)) {
    return {
      valid: false,
      from,
      to,
      reason: `Transition '${from}' -> '${to}' is not allowed`,
    };
  }

  return { valid: true, from, to };
}
