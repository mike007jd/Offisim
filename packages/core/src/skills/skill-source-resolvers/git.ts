import { ZipBombError, safeGunzipSync } from '@offisim/install-core';
import { scanSkillDir } from '../skill-scanner.js';
import { firstLevelDirs, subtreeOf } from '../virtual-tree-utils.js';
import { untarToTree } from './tar.js';
import type { ScannedSkill, SkillResolverError, VirtualTree } from './types.js';

export type GitHttpFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
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
  /**
   * Optional `sha256:…` expected over the raw tarball bytes (C/C-12). When
   * supplied, the web resolver verifies the downloaded archive matches before
   * unpacking. Useful when an outer system has already pinned the install to
   * a specific commit / release artifact.
   */
  expectedSha256?: string | undefined;
  /**
   * Optional cancellation signal forwarded to the web tarball fetch so a stalled
   * download can be aborted (the streamed read loop has no wall-clock bound on
   * its own). Desktop clone goes through the injected adapter and ignores this.
   */
  signal?: AbortSignal | undefined;
}

export interface GitResolverResult {
  tree: VirtualTree;
  scan: ScannedSkill;
  sourceRef: string;
  /** Tmp directory path (desktop only); caller cleans up post-install. */
  tmpPath?: string | undefined;
}

export const GITHUB_TARBALL_MAX_BYTES = 25 * 1024 * 1024;

function parseGithub(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.replace(/\.git$/u, ''));
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter((p) => p.length > 0);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
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
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
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

  const contentLength = resp.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > GITHUB_TARBALL_MAX_BYTES) {
      return {
        kind: 'git-fetch-failed',
        message: `GitHub tarball exceeds ${GITHUB_TARBALL_MAX_BYTES} bytes.`,
        sourceRef: input.url,
      };
    }
  }

  let buf: Uint8Array;
  try {
    buf = await readGitTarballBytesWithLimit(resp, GITHUB_TARBALL_MAX_BYTES);
  } catch (err) {
    return {
      kind: 'git-fetch-failed',
      message: `Tarball read failed: ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: input.url,
    };
  }

  if (input.expectedSha256) {
    const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
    const actual = `sha256:${[...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
    const expected = input.expectedSha256.startsWith('sha256:')
      ? input.expectedSha256
      : `sha256:${input.expectedSha256}`;
    if (actual !== expected) {
      return {
        kind: 'git-fetch-failed',
        message: `Tarball SHA-256 mismatch: expected ${expected}, got ${actual}.`,
        sourceRef: input.url,
      };
    }
  }

  let tar: Uint8Array;
  try {
    // Stream-bounded inflate (mirrors the upload resolver): trips a ZipBombError
    // before a malicious tarball can blow up memory, closing the decompression
    // asymmetry vs the raw gunzipSync this path used to call.
    tar = safeGunzipSync(buf);
  } catch (err) {
    if (err instanceof ZipBombError) {
      return {
        kind: 'git-fetch-failed',
        message: `Tarball rejected (decompression bomb guard): ${err.message}`,
        sourceRef: input.url,
      };
    }
    return {
      kind: 'git-fetch-failed',
      message: `Tarball gunzip failed: ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: input.url,
    };
  }

  let raw: VirtualTree;
  try {
    raw = untarToTree(tar, { stripFirstPathSegment: true });
  } catch (err) {
    return {
      kind: 'git-fetch-failed',
      message: `Tarball extract failed: ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: input.url,
    };
  }
  const scopedResult = applySubpath(raw, input.subpath, input.url);
  if ('kind' in scopedResult) return scopedResult;
  const scan = scanSkillDir(scopedResult);
  if ('kind' in scan) return enrichAmbiguous(scan, scopedResult);
  return { tree: scopedResult, scan, sourceRef: sourceRefDescriptor };
}

async function readGitTarballBytesWithLimit(
  resp: Awaited<ReturnType<GitHttpFetch>>,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!resp.body) {
    throw new Error('GitHub tarball response did not expose a readable stream.');
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('GitHub tarball too large');
        throw new Error(`GitHub tarball exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
 * hint some providers have been observed to either surface the candidates to
 * the user and stop, or put the chosen directory into `ref` and 404.
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
