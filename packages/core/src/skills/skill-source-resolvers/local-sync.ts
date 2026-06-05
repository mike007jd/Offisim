// Shared local-directory skill sync: the scan + cap + empty logic behind both
// `resolveClaudeCodeSync` (~/.claude/skills) and `resolveCodexSync`
// (~/.codex/skills). Each resolver is a thin wrapper that supplies its roots and
// source-specific wording; the candidate-collection logic lives here once.

import { parseSkillMd } from '../skill-md.js';
import type { SkillResolverError, SkillResolverErrorKind } from './types.js';

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
      // Skip dirs without a valid SKILL.md — they are unrelated files.
    }
  }
  return out;
}

export interface LocalSkillsSyncOptions {
  deps: SyncResolverDeps;
  /** Home-relative roots (`~/...`), scanned in order via `localDir.resolveHome`. */
  homeRoots: string[];
  /** When set and `deps.repoRoot` is present, also scans `join(repoRoot, repoSubdir)`. */
  repoSubdir?: string;
  /** Error `kind` to return when the desktop runtime / adapter is missing. */
  desktopErrorKind: SkillResolverErrorKind;
  /** Wording for the desktop-only error. */
  desktopMessage: string;
  /** Wording for the empty-result error. */
  emptyMessage: string;
}

/**
 * Shared scan + cap + empty logic for the local-directory sync resolvers.
 * Returns the full candidate list so the LLM can filter by the user's prose;
 * caps at `maxCandidates` (default 50).
 */
export async function resolveLocalSkillsSync(
  options: LocalSkillsSyncOptions,
): Promise<SyncResolverResult | SkillResolverError> {
  const { deps, homeRoots, repoSubdir, desktopErrorKind, desktopMessage, emptyMessage } = options;
  if (deps.runtime !== 'desktop' || !deps.localDir) {
    return { kind: desktopErrorKind, message: desktopMessage };
  }
  const localDir = deps.localDir;
  const scannedDirs: string[] = [];
  const candidates: SyncCandidate[] = [];
  for (const root of homeRoots) {
    const resolved = localDir.resolveHome(root);
    scannedDirs.push(resolved);
    candidates.push(...(await scanSkillsDir(resolved, localDir)));
  }
  if (repoSubdir && deps.repoRoot) {
    const projectRoot = localDir.join(deps.repoRoot, repoSubdir);
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
    return { kind: 'sync-empty', message: emptyMessage };
  }

  return { candidates, scannedDirs };
}
