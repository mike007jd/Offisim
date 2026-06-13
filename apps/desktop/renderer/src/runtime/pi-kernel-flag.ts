/**
 * Pi agent-loop kernel runtime knobs. The kernel cut-over is complete (P6) — the
 * LangGraph orchestration is gone and pi is the only chat path, so the routing
 * flag was removed. What remains is the reasoning-level knob, read from
 * localStorage so it can be tuned in a release `.app` without a rebuild
 * (`localStorage['offisim:pi-thinking-level'] = 'medium'`).
 */

const PI_THINKING_LEVEL_KEY = 'offisim:pi-thinking-level';

// Single source: the type and the runtime membership check both derive from this.
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** Reasoning level requested from thinking-capable models on the pi path. */
export function piThinkingLevel(): ThinkingLevel {
  const stored = readLocalStorage(PI_THINKING_LEVEL_KEY);
  if (stored && (THINKING_LEVELS as readonly string[]).includes(stored)) {
    return stored as ThinkingLevel;
  }
  return 'off';
}
