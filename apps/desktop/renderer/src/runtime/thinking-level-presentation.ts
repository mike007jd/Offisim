/** Human-facing reasoning labels shared by conversation and employee settings.
 * Providers own the real token budget, so descriptions stay qualitative. */
const KNOWN_THINKING_META: Record<string, { label: string; meta: string }> = {
  off: { label: 'Off', meta: 'No reasoning' },
  none: { label: 'Off', meta: 'No reasoning' },
  minimal: { label: 'Minimal', meta: 'Very brief' },
  low: { label: 'Low', meta: 'Light' },
  medium: { label: 'Medium', meta: 'Moderate' },
  high: { label: 'High', meta: 'Deep' },
  xhigh: { label: 'Extra high', meta: 'Very deep' },
  max: { label: 'Max', meta: 'Maximum' },
  ultra: { label: 'Ultra', meta: 'Proactive multi-agent' },
};

export function thinkingLevelMeta(level: string): { label: string; meta: string } {
  const known = KNOWN_THINKING_META[level];
  if (known) return known;
  const label = level
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
  return { label: label || level, meta: 'Model-defined effort' };
}
