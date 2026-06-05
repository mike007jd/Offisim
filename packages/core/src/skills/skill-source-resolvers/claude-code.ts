import {
  type SyncResolverDeps,
  type SyncResolverResult,
  resolveLocalSkillsSync,
} from './local-sync.js';
import type { SkillResolverError } from './types.js';

/**
 * Scan `~/.claude/skills/` + optional per-project `.claude/skills/` for
 * candidate skills. Returns the full list so the LLM can filter by the user's
 * prose and emit one `skill_install_confirm` per selected skill. Caps the
 * result at `maxCandidates` (default 50) to prevent runaway prompts.
 */
export async function resolveClaudeCodeSync(
  deps: SyncResolverDeps,
): Promise<SyncResolverResult | SkillResolverError> {
  return resolveLocalSkillsSync({
    deps,
    homeRoots: ['~/.claude/skills'],
    repoSubdir: '.claude/skills',
    desktopErrorKind: 'desktop-only-tool',
    desktopMessage: 'sync_from_claude_code requires the desktop runtime.',
    emptyMessage: 'No SKILL.md files found under ~/.claude/skills/ or ./.claude/skills/.',
  });
}
