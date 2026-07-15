/**
 * Company-bound projection for global conversation-run snapshots.
 *
 * The controller intentionally owns every live run so company navigation does
 * not cancel background work. UI surfaces must therefore scope the global
 * snapshot before choosing a fallback run or exposing controls.
 */
export function scopeConversationRunsToCompany<T extends { readonly companyId: string | null }>(
  snapshot: {
    readonly runs: readonly T[];
    readonly activeRuns: readonly T[];
  },
  companyId: string | null,
): { runs: readonly T[]; activeRuns: readonly T[] } {
  if (!companyId) return { runs: [], activeRuns: [] };
  return {
    runs: snapshot.runs.filter((run) => run.companyId === companyId),
    activeRuns: snapshot.activeRuns.filter((run) => run.companyId === companyId),
  };
}
