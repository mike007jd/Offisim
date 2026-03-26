/**
 * Shared scoring utility for memory-like entries (employee memory, user preferences).
 *
 * Score = importance × confidence × recency × reinforcementBonus × accessBonus
 *
 * Recency uses exponential decay: exp(-0.14 × ageDays).
 * At 5 days: ~0.50, at 7 days: ~0.38, at 14 days: ~0.14.
 */

interface Scoreable {
  importance: number;
  confidence: number;
  reinforcement_count: number;
  access_count: number;
}

/**
 * Compute a relevance score for a memory/preference entry.
 *
 * @param entry - The entry with importance, confidence, reinforcement_count, access_count
 * @param referenceDate - ISO date string for recency calculation (e.g., accessed_at, last_reinforced_at)
 * @param now - Current timestamp in ms (default: Date.now())
 */
export function scoreMemoryEntry(
  entry: Scoreable,
  referenceDate: string,
  now: number = Date.now(),
): number {
  const ageMs = now - new Date(referenceDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recency = Math.exp(-0.14 * ageDays);
  const reinforcementBonus = 1 + Math.min(entry.reinforcement_count, 5) * 0.12;
  const accessBonus = 1 + Math.min(entry.access_count, 10) * 0.02;
  return entry.importance * entry.confidence * recency * reinforcementBonus * accessBonus;
}
