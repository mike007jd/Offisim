import type { RuntimeEvidenceClass } from '@offisim/shared-types';

/**
 * Shape of a recent tool result, used for run-state tool bookkeeping
 * (RunToolResultRecord / HookRegistry recentToolResults). The completion-verifier
 * system that originally consumed this type was removed; the shape stays as the
 * shared recent-tool-result contract.
 */
export interface RecentToolResult {
  readonly toolName: string;
  readonly success: boolean;
  readonly bytes: number;
  readonly evidenceClass?: RuntimeEvidenceClass;
  readonly taskRunId?: string | null;
}
