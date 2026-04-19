import { parseSkillMd } from '../skill-md.js';
import type { LocalDirAdapter, SyncResolverDeps, SyncResolverResult } from './claude-code.js';
import type { SkillResolverError } from './types.js';

async function scanSkillsDir(rootPath: string, localDir: LocalDirAdapter) {
  const subdirs = await localDir.listSubdirs(rootPath);
  const out: SyncResolverResult['candidates'] = [];
  for (const subdir of subdirs) {
    const skillMdPath = localDir.join(rootPath, subdir, 'SKILL.md');
    try {
      const raw = await localDir.readText(skillMdPath);
      const parsed = parseSkillMd(raw);
      out.push({
        slug: subdir,
        name: parsed.name,
        description: parsed.description,
        path: skillMdPath,
        skillMd: raw,
      });
    } catch {
      // Skip dirs without a valid SKILL.md.
    }
  }
  return out;
}

/**
 * Scan `~/.codex/skills/` for candidate skills. Semantically identical to
 * `resolveClaudeCodeSync`; split into its own resolver because T2.2 tools
 * expose them as separate surfaces and the root directory differs.
 */
export async function resolveCodexSync(
  deps: SyncResolverDeps,
): Promise<SyncResolverResult | SkillResolverError> {
  if (deps.runtime !== 'desktop' || !deps.localDir) {
    return {
      kind: 'not-supported-in-web',
      message: 'sync_from_codex requires the desktop runtime.',
    };
  }
  const localDir = deps.localDir;
  const root = localDir.resolveHome('~/.codex/skills');
  const candidates = await scanSkillsDir(root, localDir);

  const cap = deps.maxCandidates ?? 50;
  if (candidates.length > cap) {
    return {
      kind: 'sync-too-many-candidates',
      message: `Found ${candidates.length} candidates — ask the user to narrow the filter.`,
      candidates: candidates.slice(0, 10).map((c) => ({
        path: c.path,
        name: c.name,
        description: c.description,
      })),
    };
  }

  if (candidates.length === 0) {
    return {
      kind: 'sync-empty',
      message: 'No SKILL.md files found under ~/.codex/skills/.',
    };
  }

  return { candidates, scannedDirs: [root] };
}
