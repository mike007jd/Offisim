import {
  type SyncResolverDeps,
  type SyncResolverResult,
  resolveLocalSkillsSync,
} from './local-sync.js';
import type { SkillResolverError } from './types.js';

/**
 * Scan `~/.codex/skills/` for candidate skills. Semantically identical to
 * `resolveClaudeCodeSync`; split into its own resolver because T2.2 tools
 * expose them as separate surfaces and the root directory differs.
 */
export async function resolveCodexSync(
  deps: SyncResolverDeps,
): Promise<SyncResolverResult | SkillResolverError> {
  return resolveLocalSkillsSync({
    deps,
    homeRoots: ['~/.codex/skills'],
    desktopErrorKind: 'desktop-only-tool',
    desktopMessage: 'sync_from_codex requires the desktop runtime.',
    emptyMessage: 'No SKILL.md files found under ~/.codex/skills/.',
  });
}
