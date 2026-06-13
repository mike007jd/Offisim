/**
 * Cut-over flag for the pi agent-loop kernel (Docs/plans/2026-06-13-pi-kernel-
 * replacement.md). While the LangGraph orchestration and the pi kernel coexist
 * (Phase 2–5, before the Phase 6 cut), desktop chat routes to one or the other
 * based on this flag.
 *
 * Read from localStorage so it can be toggled in a release `.app` without a
 * rebuild (`localStorage['offisim:pi-kernel'] = '1'`), falling back to the build
 * env var `VITE_PI_KERNEL`.
 */

const PI_KERNEL_KEY = 'offisim:pi-kernel';
const PI_THINKING_LEVEL_KEY = 'offisim:pi-thinking-level';

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
const THINKING_LEVELS: ReadonlySet<string> = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** Whether desktop chat should run through the pi kernel instead of the graph. */
export function isPiKernelEnabled(): boolean {
  const stored = readLocalStorage(PI_KERNEL_KEY);
  if (stored === '1' || stored === 'true') return true;
  if (stored === '0' || stored === 'false') return false;
  return import.meta.env.VITE_PI_KERNEL === '1';
}

/** Reasoning level requested from thinking-capable models on the pi path. */
export function piThinkingLevel(): ThinkingLevel {
  const stored = readLocalStorage(PI_THINKING_LEVEL_KEY);
  if (stored && THINKING_LEVELS.has(stored)) return stored as ThinkingLevel;
  return 'off';
}
