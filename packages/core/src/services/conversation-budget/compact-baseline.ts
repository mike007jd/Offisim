/**
 * Full-compaction baseline for a thread's conversation budget. Relocated out of
 * the (retired) LangGraph state module — it is pure budget data, not graph state.
 */

export interface CompactBaselineState {
  compactId: string;
  compactVersion: number;
  compactedAt: string;
  summaryText: string;
  compactedNonSystemMessageCount: number;
  keptTailNonSystemMessageCount: number;
}

export function parseCompactBaseline(raw: string | null): CompactBaselineState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompactBaselineState>;
    if (
      typeof parsed.compactId !== 'string' ||
      typeof parsed.compactVersion !== 'number' ||
      typeof parsed.compactedAt !== 'string' ||
      typeof parsed.summaryText !== 'string' ||
      typeof parsed.compactedNonSystemMessageCount !== 'number' ||
      typeof parsed.keptTailNonSystemMessageCount !== 'number'
    ) {
      return null;
    }
    return {
      compactId: parsed.compactId,
      compactVersion: parsed.compactVersion,
      compactedAt: parsed.compactedAt,
      summaryText: parsed.summaryText,
      compactedNonSystemMessageCount: parsed.compactedNonSystemMessageCount,
      keptTailNonSystemMessageCount: parsed.keptTailNonSystemMessageCount,
    };
  } catch {
    return null;
  }
}
