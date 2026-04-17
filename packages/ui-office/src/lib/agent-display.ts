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
  boss: 'bg-amber-500/25 text-amber-300',
  boss_summary: 'bg-amber-500/25 text-amber-300',
  manager: 'bg-emerald-500/25 text-emerald-300',
  pm_planner: 'bg-purple-500/25 text-purple-300',
  pm_replan: 'bg-purple-500/25 text-purple-300',
  pm_heartbeat: 'bg-purple-500/25 text-purple-300',
  hr: 'bg-rose-500/25 text-rose-300',
  employee: 'bg-blue-500/25 text-blue-300',
  employee_direct_setup: 'bg-blue-500/25 text-blue-300',
  error_handler: 'bg-red-500/25 text-red-300',
};

export const DEFAULT_BADGE_COLOR = 'bg-slate-500/25 text-slate-300';

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
  Boss: 'bg-amber-500/25 text-amber-300',
  PM: 'bg-purple-500/25 text-purple-300',
  Manager: 'bg-emerald-500/25 text-emerald-300',
  HR: 'bg-rose-500/25 text-rose-300',
  'Error Handler': 'bg-red-500/25 text-red-300',
  Meeting: 'bg-cyan-500/25 text-cyan-300',
};

export function getBadgeColorForDisplayName(displayName: string): string {
  return DISPLAY_NAME_BADGE_COLORS[displayName] ?? 'bg-blue-500/25 text-blue-300';
}
