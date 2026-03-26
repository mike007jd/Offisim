/**
 * Pure-logic state machines for the 6 prefab semantic categories.
 *
 * No PixiJS dependency — just transition tables and validation functions.
 * Each category defines a finite set of states and allowed transitions.
 * "decorative" has no state machine (stateless visual elements).
 */
import type { EmployeeState, SemanticCategory, WorkspacePrefabState } from '@aics/shared-types';

// ── Transition Tables ───────────────────────────────────────────
// Record<fromState, readonly toState[]>

export const WORKSPACE_TRANSITIONS: Record<string, readonly string[]> = {
  empty: ['occupied'],
  occupied: ['working', 'thinking', 'searching', 'blocked', 'idle'],
  working: ['thinking', 'searching', 'blocked', 'idle', 'occupied'],
  thinking: ['working', 'searching', 'blocked', 'idle', 'occupied'],
  searching: ['working', 'thinking', 'blocked', 'idle', 'occupied'],
  blocked: ['working', 'thinking', 'searching', 'idle', 'occupied'],
  idle: ['working', 'thinking', 'searching', 'blocked', 'occupied', 'empty'],
};

export const COMPUTE_TRANSITIONS: Record<string, readonly string[]> = {
  offline: ['idle'],
  idle: ['processing', 'error', 'offline'],
  processing: ['idle', 'overloaded', 'error'],
  overloaded: ['processing', 'idle', 'error'],
  error: ['idle', 'offline'],
};

export const KNOWLEDGE_TRANSITIONS: Record<string, readonly string[]> = {
  empty: ['stocked'],
  stocked: ['indexing', 'empty'],
  indexing: ['ready', 'error'],
  ready: ['searching', 'indexing', 'stocked'],
  searching: ['ready'],
  error: ['stocked', 'empty'],
};

export const COLLABORATION_TRANSITIONS: Record<string, readonly string[]> = {
  empty: ['scheduled'],
  scheduled: ['gathering', 'empty'],
  gathering: ['active', 'empty'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: ['empty'],
};

export const INFRASTRUCTURE_TRANSITIONS: Record<string, readonly string[]> = {
  disconnected: ['idle'],
  idle: ['transmitting', 'error', 'disconnected'],
  transmitting: ['idle', 'congested', 'error'],
  congested: ['transmitting', 'idle', 'error'],
  error: ['idle', 'disconnected'],
};

// ── Category → Table mapping ────────────────────────────────────

const CATEGORY_TABLE: Record<string, Record<string, readonly string[]> | null> = {
  workspace: WORKSPACE_TRANSITIONS,
  compute: COMPUTE_TRANSITIONS,
  knowledge: KNOWLEDGE_TRANSITIONS,
  collaboration: COLLABORATION_TRANSITIONS,
  infrastructure: INFRASTRUCTURE_TRANSITIONS,
  decorative: null,
};

// ── Initial states per category ─────────────────────────────────
// The first key in each transition table is the initial state.

const INITIAL_STATES: Record<string, string | null> = {
  workspace: 'empty',
  compute: 'offline',
  knowledge: 'empty',
  collaboration: 'empty',
  infrastructure: 'disconnected',
  decorative: null,
};

// ── Public API ──────────────────────────────────────────────────

/**
 * Returns the initial (entry) state for a prefab category.
 * Returns `null` for decorative (stateless) prefabs.
 */
export function getInitialState(category: SemanticCategory): string | null {
  return INITIAL_STATES[category] ?? null;
}

/**
 * Returns all valid states for a category.
 * Returns an empty array for decorative prefabs.
 */
export function getAllStates(category: SemanticCategory): readonly string[] {
  const table = CATEGORY_TABLE[category];
  if (!table) return [];
  return Object.keys(table);
}

/**
 * Checks whether a transition from `from` to `to` is allowed
 * within the given category's state machine.
 *
 * Returns `false` for:
 * - decorative category (no state machine)
 * - unknown from/to states
 * - self-transitions (from === to)
 */
export function canTransition(category: SemanticCategory, from: string, to: string): boolean {
  const table = CATEGORY_TABLE[category];
  if (!table) return false;

  const allowed = table[from];
  if (!allowed) return false;

  return allowed.includes(to);
}

// ── EmployeeState → WorkspacePrefabState mapping ────────────────

const EMPLOYEE_TO_WORKSPACE: Record<EmployeeState, WorkspacePrefabState> = {
  idle: 'idle',
  assigned: 'occupied',
  thinking: 'thinking',
  searching: 'searching',
  executing: 'working',
  meeting: 'idle',
  blocked: 'blocked',
  waiting: 'occupied',
  reporting: 'working',
  success: 'idle',
  failed: 'blocked',
  paused: 'idle',
};

/**
 * Maps an EmployeeState to the corresponding workspace prefab state.
 * Used to synchronize desk/workstation visuals with employee activity.
 */
export function inferWorkspaceState(employeeState: EmployeeState): WorkspacePrefabState {
  return EMPLOYEE_TO_WORKSPACE[employeeState];
}
