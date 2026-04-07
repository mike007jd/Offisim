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

/** Format an ISO date string as "Apr 8". */
export function formatSopDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Format an ISO date string as "Apr 8, 2:30 PM". */
export function formatSopDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
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

/** Pill toggle className — shared between sidebar mode pivot and context pane tabs. */
export function pillClass(active: boolean): string {
  return `text-[10px] px-2 py-0.5 rounded-full transition-colors ${
    active
      ? 'bg-white/10 text-slate-200'
      : 'text-slate-500 hover:text-slate-300'
  }`;
}
