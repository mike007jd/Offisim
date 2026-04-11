import type { SopDefinition } from '@offisim/shared-types';

/** Parse a SopDefinition JSON string, returning null if invalid or empty. */
export function parseSopDefinition(json: string): SopDefinition | null {
  try {
    const def = JSON.parse(json) as SopDefinition;
    return Array.isArray(def.steps) && def.steps.length > 0 ? def : null;
  } catch {
    return null;
  }
}

export type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed';

/** Step status display config — single source of truth for label + color. */
export const SOP_STEP_STATUS: Record<SopStepStatus, { label: string; color: string }> = {
  active: { label: '▶ Active', color: 'text-blue-400' },
  completed: { label: '✓ Done', color: 'text-green-400' },
  failed: { label: '✗ Failed', color: 'text-red-400' },
  pending: { label: '○ Pending', color: 'text-slate-500' },
};

// pillClass moved to ui-utils.ts — re-export for backward compat
export { pillClass } from './ui-utils';
