import type { RuntimeEntityType } from './states.js';

/**
 * Minimal cross-package event envelope.
 *
 * Payload typing is intentionally loose here — each consuming package
 * narrows via its own event catalog. shared-types only defines the envelope.
 */
export type RuntimeEvent<T extends string = string> = {
  /** Dot-delimited event type, e.g. "employee.state.changed" */
  readonly type: T;
  /** The entity this event is about */
  readonly entityId: string;
  /** Top-level entity kind */
  readonly entityType: RuntimeEntityType;
  /** Unix ms timestamp */
  readonly timestamp: number;
  /** Event-specific data — narrowed by consumers */
  readonly payload?: Readonly<Record<string, unknown>>;
};

/**
 * Well-known event type prefixes.
 * Consuming packages define the full catalog; these are just the namespaces.
 */
export type EventFamily =
  | 'employee.state.changed'
  | 'task.state.changed'
  | 'task.assignment.changed'
  | 'meeting.state.changed'
  | 'install.state.changed'
  | 'binding.state.changed'
  | 'report.state.changed'
  | 'runtime.performance.tier.changed'
  | 'ui.selection.changed';
