import type { EmployeeState, RuntimeEvent } from '@aics/shared-types';

/**
 * Lightweight event bus interface for the renderer.
 * Renderer depends on @aics/shared-types only — the bridge from @aics/core EventBus
 * is provided by the React integration layer.
 *
 * Handler uses `RuntimeEvent<any>` to stay structurally compatible with core's
 * EventHandler type, avoiding the need for `as` casts at the call site (I2).
 */
export interface SceneEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(prefix: string, handler: (event: RuntimeEvent<any>) => void): () => void;
}

/** Seed employee definition */
export interface EmployeeSeed {
  readonly id: string;
  readonly name: string;
}

/**
 * Mapping from a graph node name to an employee entity + visual state.
 * When the node enters, the mapped employee transitions to `enterState`;
 * when the node exits, the employee reverts to idle.
 */
export interface NodeVisualMapping {
  /** Which employee entity to activate */
  readonly employeeId: string;
  /** What state to set when the node is entered */
  readonly enterState: EmployeeState;
}

/** Options for SceneManager construction */
export interface SceneManagerOptions {
  /** Container element to mount the PixiJS canvas into */
  container: HTMLElement;
  /** Event bus for receiving runtime events */
  eventBus: SceneEventBus;
  /** Seed employees to render */
  employees?: EmployeeSeed[];
  /** Whether to use reduced motion */
  reducedMotion?: boolean;
  /**
   * Map graph node names to employee visual states.
   * When a graph node enters, the mapped employee transitions to the specified state.
   * When the node exits, the employee reverts to idle.
   * Defaults to DEFAULT_NODE_VISUAL_MAP if not provided.
   */
  nodeVisualMap?: Record<string, NodeVisualMapping>;
}

/** Default employee seeds */
export const DEFAULT_EMPLOYEES: EmployeeSeed[] = [
  { id: 'emp-alice', name: 'Alice' },
  { id: 'emp-bob', name: 'Bob' },
  { id: 'emp-carol', name: 'Carol' },
];

/**
 * Default mapping of graph node names to scene employee visual states.
 * - boss (routing/LLM call) → Alice (engineering_manager) as 'thinking'
 * - manager (task planning) → Bob (developer) as 'assigned'
 * - boss_summary (final report) → Alice as 'reporting'
 * - employee node is handled directly by employee.state.changed events (no static mapping needed)
 */
export const DEFAULT_NODE_VISUAL_MAP: Record<string, NodeVisualMapping> = {
  boss: { employeeId: 'emp-alice', enterState: 'thinking' },
  manager: { employeeId: 'emp-bob', enterState: 'assigned' },
  boss_summary: { employeeId: 'emp-alice', enterState: 'reporting' },
};
