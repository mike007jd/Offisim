/**
 * Data-driven state feedback matrix — per SCENE_STATE_MATRIX.md §6, §12
 *
 * Maps employee runtime states to an ordered array of scene signals.
 * Used by the renderer to decide which visual feedback to apply.
 */

import type { EmployeeState } from '@aics/shared-types';

/** Signal types available in the scene */
export type SceneSignalType =
  | 'ring_color' // state ring color change
  | 'ring_pulse' // ring pulse animation
  | 'badge' // status badge icon
  | 'bubble' // task/status bubble
  | 'route_line' // connection line to target
  | 'room_glow' // room emphasis glow
  | 'ambient_dim'; // reduce ambient motion nearby

/** Priority levels for competing state signals */
export type SignalPriority = 'critical' | 'high' | 'medium' | 'low' | 'ambient';

export interface StateSignal {
  type: SceneSignalType;
  priority: SignalPriority;
  /** Duration in ms (0 = persistent until state change) */
  durationMs: number;
  /** Additional config per signal type */
  config?: Record<string, unknown>;
}

/**
 * Data-driven state -> signal mapping.
 * Each employee state maps to an ordered array of scene signals.
 * Higher priority signals take precedence when states compete.
 */
export const EMPLOYEE_STATE_SIGNALS: Record<EmployeeState, StateSignal[]> = {
  idle: [{ type: 'ring_color', priority: 'ambient', durationMs: 0 }],
  assigned: [
    { type: 'ring_color', priority: 'low', durationMs: 0 },
    { type: 'ring_pulse', priority: 'low', durationMs: 0, config: { amplitude: 1.03, period: 2000 } },
  ],
  thinking: [
    { type: 'ring_color', priority: 'medium', durationMs: 0 },
    { type: 'ring_pulse', priority: 'medium', durationMs: 0, config: { amplitude: 1.01, period: 1500 } },
    { type: 'badge', priority: 'medium', durationMs: 0, config: { icon: 'thought' } },
  ],
  searching: [
    { type: 'ring_color', priority: 'medium', durationMs: 0 },
    { type: 'ring_pulse', priority: 'medium', durationMs: 0, config: { amplitude: 1.05, period: 300 } },
    { type: 'badge', priority: 'medium', durationMs: 0, config: { icon: 'search' } },
  ],
  executing: [
    { type: 'ring_color', priority: 'high', durationMs: 0 },
    { type: 'ring_pulse', priority: 'high', durationMs: 0, config: { amplitude: 1.02, period: 800 } },
    { type: 'badge', priority: 'high', durationMs: 0, config: { icon: 'bolt' } },
  ],
  meeting: [
    { type: 'ring_color', priority: 'high', durationMs: 0 },
    { type: 'route_line', priority: 'high', durationMs: 0, config: { target: 'meeting_room' } },
    { type: 'ambient_dim', priority: 'high', durationMs: 0 },
  ],
  blocked: [
    { type: 'ring_color', priority: 'critical', durationMs: 0 },
    { type: 'ring_pulse', priority: 'critical', durationMs: 0, config: { amplitude: 1.04, period: 600 } },
    { type: 'badge', priority: 'critical', durationMs: 0, config: { icon: 'alert' } },
  ],
  waiting: [
    { type: 'ring_color', priority: 'low', durationMs: 0 },
    { type: 'badge', priority: 'low', durationMs: 0, config: { icon: 'clock' } },
  ],
  reporting: [
    { type: 'ring_color', priority: 'medium', durationMs: 0 },
    { type: 'ring_pulse', priority: 'medium', durationMs: 0, config: { amplitude: 1.02, period: 1200 } },
    { type: 'badge', priority: 'medium', durationMs: 0, config: { icon: 'document' } },
  ],
  success: [
    { type: 'ring_color', priority: 'high', durationMs: 3000 },
    { type: 'badge', priority: 'high', durationMs: 3000, config: { icon: 'check' } },
  ],
  failed: [
    { type: 'ring_color', priority: 'critical', durationMs: 0 },
    { type: 'badge', priority: 'critical', durationMs: 0, config: { icon: 'x' } },
  ],
  paused: [
    { type: 'ring_color', priority: 'low', durationMs: 0 },
    { type: 'badge', priority: 'low', durationMs: 0, config: { icon: 'pause' } },
  ],
};

/** Priority ordering for signal conflict resolution */
export const SIGNAL_PRIORITY_ORDER: Record<SignalPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  ambient: 0,
};

/** Resolve which signals win when multiple states compete */
export function resolveCompetingSignals(signals: StateSignal[]): StateSignal[] {
  // Group by type, keep highest priority per type
  const byType = new Map<SceneSignalType, StateSignal>();
  for (const signal of signals) {
    const existing = byType.get(signal.type);
    if (!existing || SIGNAL_PRIORITY_ORDER[signal.priority] > SIGNAL_PRIORITY_ORDER[existing.priority]) {
      byType.set(signal.type, signal);
    }
  }
  return Array.from(byType.values());
}
