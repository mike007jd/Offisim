import { parseSkillMd } from '../skill-md.js';
import type {
  LocalDirAdapter,
  SyncCandidate,
  SyncResolverDeps,
  SyncResolverResult,
} from './claude-code.js';
import type { SkillResolverError, SkillResolverErrorKind } from './types.js';

async function scanSkillsDir(
  rootPath: string,
  localDir: LocalDirAdapter,
): Promise<SyncCandidate[]> {
  const subdirs = await localDir.listSubdirs(rootPath);
  const out: SyncCandidate[] = [];
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

interface LocalSkillsSyncOptions {
  deps: SyncResolverDeps;
  /** Roots to scan, in order; resolved via `localDir.resolveHome`. */
  roots: string[];
  /** Error `kind` to return when the desktop runtime / adapter is missing. */
  desktopErrorKind: SkillResolverErrorKind;
  /** Wording for the desktop-only error. */
  desktopMessage: string;
  /** Wording for the empty-result error. */
  emptyMessage: string;
}

/**
 * Shared scan + cap + empty logic for the local-directory sync resolvers
 * (`~/.claude/skills`, `~/.codex/skills`). Parameterized by root dirs and the
 * desktop-only error kind so each resolver shares one outcome shape while
 * keeping source-specific wording. Returns the full candidate list so the LLM
 * can filter by the user's prose; caps at `maxCandidates` (default 50).
 */
async function resolveLocalSkillsSync(
  options: LocalSkillsSyncOptions,
): Promise<SyncResolverResult | SkillResolverError> {
  const { deps, roots, desktopErrorKind, desktopMessage, emptyMessage } = options;
  if (deps.runtime !== 'desktop' || !deps.localDir) {
    return { kind: desktopErrorKind, message: desktopMessage };
  }
  const localDir = deps.localDir;
  const scannedDirs: string[] = [];
  const candidates: SyncCandidate[] = [];
  for (const root of roots) {
    const resolved = localDir.resolveHome(root);
    scannedDirs.push(resolved);
    candidates.push(...(await scanSkillsDir(resolved, localDir)));
  }

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
    return { kind: 'sync-empty', message: emptyMessage };
  }

  return { candidates, scannedDirs };
}

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
    roots: ['~/.codex/skills'],
    desktopErrorKind: 'desktop-only-tool',
    desktopMessage: 'sync_from_codex requires the desktop runtime.',
    emptyMessage: 'No SKILL.md files found under ~/.codex/skills/.',
  });
}
