/** Shared state → Badge variant / Tailwind dot class mappings.
 *  Single source of truth — consumed by AgentCard, EmployeeInspector,
 *  TeamHealthCard, CompanyStatusCard. */

import type { BadgeProps } from '@offisim/ui-core';

export const STATE_VARIANTS: Record<string, BadgeProps['variant']> = {
  idle: 'secondary',
  assigned: 'info',
  thinking: 'info',
  executing: 'success',
  meeting: 'default',
  blocked: 'error',
  failed: 'error',
  waiting: 'warning',
};

export const STATUS_DOTS: Record<string, string> = {
  idle: 'bg-slate-400',
  assigned: 'bg-blue-500',
  thinking: 'bg-blue-500',
  executing: 'bg-emerald-500',
  meeting: 'bg-purple-500',
  blocked: 'bg-red-500',
  failed: 'bg-red-500',
  waiting: 'bg-amber-500',
};
