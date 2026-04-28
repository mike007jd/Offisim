import { gunzipSync } from 'fflate';
import { scanSkillDir } from '../skill-scanner.js';
import { firstLevelDirs, subtreeOf } from '../virtual-tree-utils.js';
import type { ScannedSkill, SkillResolverError, VirtualTree } from './types.js';

export type GitHttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface GitCloneAdapter {
  /**
   * Desktop-only git clone. Clones `url` at `ref` (default branch when absent)
   * into a tmp directory and returns a promise of the local path. The caller
   * scans that directory via an injected local fs adapter.
   */
  clone(args: {
    url: string;
    ref?: string | undefined;
  }): Promise<{ tmpPath: string; stderrTail?: string }>;
}

export interface GitLocalFsAdapter {
  /** Read the tree at the local path into a virtual tree. */
  readTree(localPath: string): Promise<VirtualTree>;
  /** Best-effort cleanup after the install commits. */
  cleanup(localPath: string): Promise<void>;
}

export interface GitResolverDeps {
  runtime: 'desktop' | 'web';
  httpFetch: GitHttpFetch;
  clone?: GitCloneAdapter | undefined;
  localFs?: GitLocalFsAdapter | undefined;
}

export interface GitResolverInput {
  url: string;
  ref?: string | undefined;
  /**
   * Optional repo-relative directory (e.g. `do-research`) when the repo is a
   * multi-skill monorepo like `anthropics/skills`. The resolver narrows the
   * scanner's view to that subtree before locating SKILL.md.
   */
  subpath?: string | undefined;
}

export interface GitResolverResult {
  tree: VirtualTree;
  scan: ScannedSkill;
  sourceRef: string;
  /** Tmp directory path (desktop only); caller cleans up post-install. */
  tmpPath?: string | undefined;
}

function parseGithub(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.replace(/\.git$/u, ''));
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter((p) => p.length > 0);
    if (parts.length < 2) return null;
    return { owner: parts[0]!, repo: parts[1]! };
  } catch {
    return null;
  }
}

// Minimal ustar parser — shared with upload resolver but kept inline to avoid
// a cross-resolver helper file just for a ~30-line routine.
function untarToTree(bytes: Uint8Array): VirtualTree {
  const files: VirtualTree['files'] = [];
  let offset = 0;
  const td = new TextDecoder('utf-8');
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const nameBytes = header.subarray(0, 100);
    const nameEnd = nameBytes.indexOf(0);
    let name = td.decode(nameEnd === -1 ? nameBytes : nameBytes.subarray(0, nameEnd));
    const prefixBytes = header.subarray(345, 500);
    const prefixEnd = prefixBytes.indexOf(0);
    const prefix = td.decode(prefixEnd === -1 ? prefixBytes : prefixBytes.subarray(0, prefixEnd));
    if (prefix) name = `${prefix}/${name}`;
    const sizeStr = td.decode(header.subarray(124, 136)).replace(/\0.*$/u, '').trim();
    const size = sizeStr ? Number.parseInt(sizeStr, 8) : 0;
    const typeFlag = String.fromCharCode(header[156]!);
    offset += 512;
    if ((typeFlag === '0' || typeFlag === '\0') && name && size > 0) {
      const content = bytes.subarray(offset, offset + size);
      // GitHub tarballs wrap everything under `<repo>-<sha>/`; strip the first
      // segment so the scanner sees SKILL.md at depth 1 (or in one subdirectory).
      const stripped = name.split('/').slice(1).join('/');
      if (stripped.length > 0) {
        files.push({ path: stripped, content: new Uint8Array(content) });
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return { files };
}

/**
 * Git source resolver. Splits on runtime:
 *
 *   - Desktop: hands off to `clone()` + `localFs.readTree()`, supporting any
 *     git URL the user's local `git` binary understands. The caller (skill
 *     install tool handler) is responsible for providing a Tauri-shell-backed
 *     adapter; this module stays runtime-agnostic.
 *   - Web: accepts GitHub URLs only, fetches the repo tarball via the public
 *     unauthenticated GitHub API, decompresses in-memory with `fflate`. No
 *     git library is added to the web bundle.
 */
export async function resolveGitSource(
  input: GitResolverInput,
  deps: GitResolverDeps,
): Promise<GitResolverResult | SkillResolverError> {
  const sourceRefBase = input.ref ? `git:${input.url}@${input.ref}` : `git:${input.url}`;
  const sourceRefDescriptor = input.subpath ? `${sourceRefBase}#${input.subpath}` : sourceRefBase;

  if (deps.runtime === 'desktop') {
    if (!deps.clone || !deps.localFs) {
      return {
        kind: 'git-fetch-failed',
        message: 'Desktop git resolver requires clone + localFs adapters.',
        sourceRef: input.url,
      };
    }
    try {
      const { tmpPath } = await deps.clone.clone({
        url: input.url,
        ...(input.ref !== undefined ? { ref: input.ref } : {}),
      });
      const raw = await deps.localFs.readTree(tmpPath);
      const scopedResult = applySubpath(raw, input.subpath, input.url);
      if ('kind' in scopedResult) {
        await deps.localFs.cleanup(tmpPath).catch(() => {});
        return scopedResult;
      }
      const scan = scanSkillDir(scopedResult);
      if ('kind' in scan) {
        await deps.localFs.cleanup(tmpPath).catch(() => {});
        return enrichAmbiguous(scan, scopedResult);
      }
      return { tree: scopedResult, scan, sourceRef: sourceRefDescriptor, tmpPath };
    } catch (err) {
      return {
        kind: 'git-fetch-failed',
        message: `git clone failed: ${err instanceof Error ? err.message : String(err)}`,
        sourceRef: input.url,
      };
    }
  }

  const gh = parseGithub(input.url);
  if (!gh) {
    return {
      kind: 'git-web-non-github',
      message: `Web runtime can only install from github.com URLs. Got: ${input.url}`,
      sourceRef: input.url,
    };
  }

  const ref = input.ref ?? '';
  const tarballUrl = ref
    ? `https://api.github.com/repos/${gh.owner}/${gh.repo}/tarball/${encodeURIComponent(ref)}`
    : `https://api.github.com/repos/${gh.owner}/${gh.repo}/tarball`;

  const resp = await deps.httpFetch(tarballUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Offisim-Skill-Installer',
    },
  });

  if (resp.status === 403) {
    const resetHeader = resp.headers.get('x-ratelimit-reset');
    const resetAt = resetHeader ? Number(resetHeader) * 1000 : Date.now() + 60 * 60 * 1000;
    return {
      kind: 'github-rate-limited',
      message: 'GitHub unauthenticated tarball API rate-limited.',
      sourceRef: input.url,
      resetAt,
    };
  }
  if (resp.status === 404 && input.ref) {
    // LLMs frequently put a repo subdirectory into `ref`. Surface a directive
    // error so the model retries with `subpath` instead of a second bad ref.
    return {
      kind: 'git-ref-not-found',
      message: `Git ref "${input.ref}" not found in ${gh.owner}/${gh.repo}. If you meant a directory inside the repo (e.g. the skill name for a monorepo), retry install_skill_from_git with subpath="${input.ref}" and DROP the ref parameter.`,
      sourceRef: input.url,
    };
  }
  if (!resp.ok) {
    return {
      kind: 'git-fetch-failed',
      message: `GitHub tarball fetch failed (${resp.status}).`,
      sourceRef: input.url,
    };
  }

  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    return {
      kind: 'git-fetch-failed',
      message: `Could not read tarball body: ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: input.url,
    };
  }

  let tar: Uint8Array;
  try {
    tar = gunzipSync(buf);
  } catch (err) {
    return {
      kind: 'git-fetch-failed',
      message: `Tarball gunzip failed: ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: input.url,
    };
  }

  const raw = untarToTree(tar);
  const scopedResult = applySubpath(raw, input.subpath, input.url);
  if ('kind' in scopedResult) return scopedResult;
  const scan = scanSkillDir(scopedResult);
  if ('kind' in scan) return enrichAmbiguous(scan, scopedResult);
  return { tree: scopedResult, scan, sourceRef: sourceRefDescriptor };
}

function applySubpath(
  tree: VirtualTree,
  subpath: string | undefined,
  sourceRef: string,
): VirtualTree | SkillResolverError {
  if (!subpath) return tree;
  const scoped = subtreeOf(tree, subpath);
  if (scoped.files.length === 0) {
    const dirs = firstLevelDirs(tree);
    return {
      kind: 'git-subpath-not-found',
      message: `Subpath "${subpath}" not found in repository. ${
        dirs.length > 0
          ? `Retry with one of these directory names as subpath: ${dirs.map((d) => `"${d}"`).join(', ')}.`
          : 'No candidate directories available.'
      }`,
      sourceRef,
      candidates: dirs.map((name) => ({ path: `${name}/` })),
    };
  }
  return scoped;
}

/**
 * When the scanner reports `ambiguous` on the effective tree, fill `candidates`
 * with first-level directories (if not already populated) and rewrite the
 * message to directly instruct the LLM to retry with `subpath`. Without this
 * hint MiniMax has been observed to either (a) surface the candidates to the
 * user and stop, or (b) stuff the chosen directory into `ref` and 404.
 */
function enrichAmbiguous(err: SkillResolverError, tree: VirtualTree): SkillResolverError {
  if (err.kind !== 'skill-scanner-ambiguous') return err;
  const dirs =
    err.candidates && err.candidates.length > 0
      ? err.candidates.map((c) => c.path.replace(/\/$/u, ''))
      : firstLevelDirs(tree);
  if (dirs.length === 0) return err;
  const candidates = dirs.map((name) => ({ path: `${name}/` }));
  const message = `Multiple SKILL.md files found. Retry install_skill_from_git with the same url AND subpath=<one of: ${dirs.map((d) => `"${d}"`).join(', ')}>. Do NOT put these directory names into ref.`;
  return { ...err, candidates, message };
}
