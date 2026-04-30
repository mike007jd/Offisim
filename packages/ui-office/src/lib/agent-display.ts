/** Canonical node-name → human label mapping. */
export const NODE_DISPLAY_NAMES: Record<string, string> = {
  boss: 'Boss',
  boss_summary: 'Boss',
  employee: 'Employee',
  employee_direct_setup: 'Employee',
  manager: 'Manager',
  pm_planner: 'PM',
  pm_replan: 'PM',
  pm_heartbeat: 'PM',
  hr: 'HR',
  error_handler: 'Error Handler',
  step_dispatcher: 'Dispatcher',
  step_advance: 'Dispatcher',
};

export function humanizeNodeName(nodeName: string): string {
  return NODE_DISPLAY_NAMES[nodeName] ?? nodeName.replaceAll('_', ' ');
}

/** Badge color classes keyed by graph node name. */
export const NODE_BADGE_COLORS: Record<string, string> = {
  boss: 'bg-warning-muted text-warning',
  boss_summary: 'bg-warning-muted text-warning',
  manager: 'bg-success-muted text-success',
  pm_planner: 'bg-accent-muted text-accent-text',
  pm_replan: 'bg-accent-muted text-accent-text',
  pm_heartbeat: 'bg-accent-muted text-accent-text',
  hr: 'bg-error-muted text-error',
  employee: 'bg-info-muted text-info',
  employee_direct_setup: 'bg-info-muted text-info',
  error_handler: 'bg-error-muted text-error',
};

export const DEFAULT_BADGE_COLOR = 'bg-surface-muted text-text-secondary';

/** Pre-chunk placeholder text, keyed by graph node name. Short verb form — the
 *  shimmer + elapsed counter carry the "still working" signal. */
export const NODE_PLACEHOLDERS: Record<string, string> = {
  boss: 'Drafting',
  boss_summary: 'Summarizing',
  employee: 'Working',
  manager: 'Coordinating',
  pm_planner: 'Planning',
  pm_replan: 'Reworking plan',
  pm_heartbeat: 'Checking progress',
  hr: 'Reviewing',
  error_handler: 'Recovering',
  step_dispatcher: 'Dispatching',
};

export const DEFAULT_PLACEHOLDER = 'Thinking';

/** Resolve badge color for a display name (used by MessageBubble). */
const DISPLAY_NAME_BADGE_COLORS: Record<string, string> = {
  Boss: 'bg-warning-muted text-warning',
  PM: 'bg-accent-muted text-accent-text',
  Manager: 'bg-success-muted text-success',
  HR: 'bg-error-muted text-error',
  'Error Handler': 'bg-error-muted text-error',
  Meeting: 'bg-info-muted text-info',
};

export function getBadgeColorForDisplayName(displayName: string): string {
  return DISPLAY_NAME_BADGE_COLORS[displayName] ?? 'bg-info-muted text-info';
}
