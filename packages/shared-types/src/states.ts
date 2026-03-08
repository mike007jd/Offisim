/** Employee lifecycle states — source: SCENE_STATE_MATRIX §6 + install state machine */
export type EmployeeState =
  | 'idle'
  | 'assigned'
  | 'thinking'
  | 'searching'
  | 'executing'
  | 'meeting'
  | 'blocked'
  | 'waiting'
  | 'reporting'
  | 'success'
  | 'failed'
  | 'paused';

/** Task lifecycle states — source: SCENE_STATE_MATRIX §7 */
export type TaskState =
  | 'created'
  | 'routed'
  | 'queued'
  | 'active'
  | 'waiting_input'
  | 'waiting_dependency'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Install transaction states — source: aics_install_state_machine.md
 * Binding happens BEFORE materializing (裁决确认).
 */
export type InstallState =
  | 'created'
  | 'manifest_loaded'
  | 'integrity_checked'
  | 'compatibility_checked'
  | 'dependency_planned'
  | 'awaiting_confirmation'
  | 'awaiting_bindings'
  | 'ready_to_install'
  | 'materializing'
  | 'installed'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';

/** Meeting lifecycle states — source: SCENE_STATE_MATRIX §8 */
export type MeetingState = 'scheduled' | 'gathering' | 'active' | 'waiting' | 'ended';

/** Report lifecycle states — source: SCENE_STATE_MATRIX §10 */
export type ReportState = 'drafting' | 'ready' | 'delivered' | 'rejected';

/** Entity types that can emit runtime events */
export type RuntimeEntityType = 'employee' | 'task' | 'meeting' | 'install' | 'report' | 'llm' | 'graph';
