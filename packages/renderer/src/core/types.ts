import type { Container } from 'pixi.js';
import type { EmployeeState, RuntimeEvent } from '@aics/shared-types';

/**
 * Lightweight event bus interface for the renderer.
 * Renderer depends on @aics/shared-types only — the bridge from @aics/core EventBus
 * is provided by the React integration layer.
 *
 * Handler uses `RuntimeEvent<any>` to stay structurally compatible with core's
 * EventHandler type — TS interfaces lack index signatures so specific payload
 * interfaces are not assignable to `RuntimeEvent<Record<string, unknown>>`.
 */
export interface SceneEventBus {
  // biome-ignore lint/suspicious/noExplicitAny: must accept all RuntimeEvent payload types
  on(prefix: string, handler: (event: RuntimeEvent<any>) => void): () => void;
}

// ---------------------------------------------------------------------------
// Entity types — normal employees vs OpenClaw agents
// ---------------------------------------------------------------------------

/**
 * Visual entity type determines which renderer class to use.
 * - 'employee': standard human-like avatar (EmployeeEntity — circle + initial)
 * - 'lobster': pixel-art lobster (LobsterEntity — OpenClaw imported agent)
 */
export type SceneEntityType = 'employee' | 'lobster';

/**
 * Common interface for all scene entities (EmployeeEntity, LobsterEntity, etc.).
 * SceneManager operates on this interface — it doesn't care which visual class
 * is underneath.
 */
export interface SceneEntity {
  readonly container: Container;
  readonly id: string;
  setState(next: EmployeeState): void;
  setTask(taskId: string | null): void;
  setHighlight(on: boolean): void;
  destroy(): void;
}

/** Seed employee definition */
export interface EmployeeSeed {
  readonly id: string;
  readonly name: string;
  /**
   * Which visual entity to render for this employee.
   * - 'employee' (default): standard avatar — for company's own employees
   * - 'lobster': pixel lobster — for OpenClaw imported agents
   */
  readonly entityType?: SceneEntityType;
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
