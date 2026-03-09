import type { RuntimeEvent } from '@aics/shared-types';

/**
 * Lightweight event bus interface for the renderer.
 * Renderer depends on @aics/shared-types only — the bridge from @aics/core EventBus
 * is provided by the React integration layer.
 */
export interface SceneEventBus {
  on(prefix: string, handler: (event: RuntimeEvent) => void): () => void;
}

/** Seed employee definition */
export interface EmployeeSeed {
  readonly id: string;
  readonly name: string;
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
}

/** Default employee seeds */
export const DEFAULT_EMPLOYEES: EmployeeSeed[] = [
  { id: 'emp-alice', name: 'Alice' },
  { id: 'emp-bob', name: 'Bob' },
  { id: 'emp-carol', name: 'Carol' },
];
