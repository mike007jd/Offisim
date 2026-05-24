/** Shared state → Badge variant / Tailwind dot class mappings.
 *  Single source of truth for agent status surfaces. */

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
  idle: 'bg-ink-3',
  assigned: 'bg-accent',
  thinking: 'bg-accent',
  executing: 'bg-ok',
  meeting: 'bg-accent',
  blocked: 'bg-danger',
  failed: 'bg-danger',
  waiting: 'bg-warn',
};
