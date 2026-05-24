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
  boss: 'bg-warn-surface text-warn',
  boss_summary: 'bg-warn-surface text-warn',
  manager: 'bg-ok-surface text-ok',
  pm_planner: 'bg-accent-surface text-accent',
  pm_replan: 'bg-accent-surface text-accent',
  pm_heartbeat: 'bg-accent-surface text-accent',
  hr: 'bg-danger-surface text-danger',
  employee: 'bg-accent-surface text-accent',
  employee_direct_setup: 'bg-accent-surface text-accent',
  error_handler: 'bg-danger-surface text-danger',
};

export const DEFAULT_BADGE_COLOR = 'bg-surface-2 text-ink-2';

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

/** Resolve badge color for legacy display surfaces that still need name-derived badges. */
const DISPLAY_NAME_BADGE_COLORS: Record<string, string> = {
  Boss: 'bg-warn-surface text-warn',
  PM: 'bg-accent-surface text-accent',
  Manager: 'bg-ok-surface text-ok',
  HR: 'bg-danger-surface text-danger',
  'Error Handler': 'bg-danger-surface text-danger',
  Meeting: 'bg-accent-surface text-accent',
};

export function getBadgeColorForDisplayName(displayName: string): string {
  return DISPLAY_NAME_BADGE_COLORS[displayName] ?? 'bg-accent-surface text-accent';
}
