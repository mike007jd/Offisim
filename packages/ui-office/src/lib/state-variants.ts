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
  idle: 'bg-text-muted',
  assigned: 'bg-info',
  thinking: 'bg-info',
  executing: 'bg-success',
  meeting: 'bg-accent',
  blocked: 'bg-error',
  failed: 'bg-error',
  waiting: 'bg-warning',
};
