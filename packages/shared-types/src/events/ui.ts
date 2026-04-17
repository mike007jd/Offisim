export interface UiSelectionPayload {
  readonly entityId: string | null;
  readonly entityType: 'employee' | 'meeting' | 'install';
  readonly source: 'scene' | 'panel';
}

/** Emitted by TaskDashboard when a task row is clicked — scene reacts. */
export interface UiTaskFocusedPayload {
  readonly employeeId: string;
  readonly taskRunId: string;
}

/** Emitted by SceneManager when an employee is clicked — UI reacts. */
export interface SceneEmployeeSelectedPayload {
  readonly employeeId: string;
  /** Source of the selection — always 'scene' for this event. */
  readonly source: 'scene';
}
