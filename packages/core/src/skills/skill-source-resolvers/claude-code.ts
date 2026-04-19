import { parseSkillMd } from '../skill-md.js';
import type { SkillResolverError } from './types.js';

export interface LocalDirAdapter {
  /** List direct subdirectories of `absPath`. Returns [] when dir missing. */
  listSubdirs(absPath: string): Promise<string[]>;
  /** Read a single file as UTF-8; rejects when missing. */
  readText(absPath: string): Promise<string>;
  /** Expand a leading `~` (home-dir); returns `absPath` verbatim otherwise. */
  resolveHome(relOrAbs: string): string;
  /** Forward-slash path join. */
  join(...parts: string[]): string;
}

export interface SyncResolverDeps {
  runtime: 'desktop' | 'web';
  localDir?: LocalDirAdapter | undefined;
  /** Optional current-repo root; when present, also scans `<root>/.claude/skills/`. */
  repoRoot?: string | undefined;
  /** Hard cap — resolvers return an overflow error past this. */
  maxCandidates?: number | undefined;
}

export interface SyncCandidate {
  slug: string;
  name: string;
  description: string;
  path: string;
  skillMd: string;
}

export interface SyncResolverResult {
  candidates: SyncCandidate[];
  scannedDirs: string[];
}

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
      // Skip dirs that don't have a valid SKILL.md — they are unrelated files.
    }
  }
  return out;
}

/**
 * Scan `~/.claude/skills/` + optional per-project `.claude/skills/` for
 * candidate skills. Returns the full list so the LLM can filter by the user's
 * prose and emit one `skill_install_confirm` per selected skill. Caps the
 * result at `maxCandidates` (default 50) to prevent runaway prompts.
 */
export async function resolveClaudeCodeSync(
  deps: SyncResolverDeps,
): Promise<SyncResolverResult | SkillResolverError> {
  if (deps.runtime !== 'desktop' || !deps.localDir) {
    return {
      kind: 'not-supported-in-web',
      message: 'sync_from_claude_code requires the desktop runtime.',
    };
  }
  const localDir = deps.localDir;
  const scannedDirs: string[] = [];
  const candidates: SyncCandidate[] = [];

  const globalRoot = localDir.resolveHome('~/.claude/skills');
  scannedDirs.push(globalRoot);
  candidates.push(...(await scanSkillsDir(globalRoot, localDir)));

  if (deps.repoRoot) {
    const projectRoot = localDir.join(deps.repoRoot, '.claude/skills');
    scannedDirs.push(projectRoot);
    candidates.push(...(await scanSkillsDir(projectRoot, localDir)));
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
    return {
      kind: 'sync-empty',
      message: 'No SKILL.md files found under ~/.claude/skills/ or ./.claude/skills/.',
    };
  }

  return { candidates, scannedDirs };
}
