const GITHUB_API_BASE_URL = 'https://api.github.com';

function buildGithubTarballPath(owner: string, repo: string, ref?: string): string {
  return ref
    ? `/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`
    : `/repos/${owner}/${repo}/tarball`;
}

export function buildGithubTarballRequest(
  owner: string,
  repo: string,
  ref?: string,
  options?: { proxyOrigin?: string | null },
): {
  url: string;
  init: {
    headers: Record<string, string>;
  };
} {
  const path = buildGithubTarballPath(owner, repo, ref);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Offisim-Skill-Installer',
  };

  if (options?.proxyOrigin) {
    return {
      url: `${options.proxyOrigin}/api/llm-proxy${path}`,
      init: {
        headers: {
          ...headers,
          'X-LLM-Base-URL': GITHUB_API_BASE_URL,
        },
      },
    };
  }

  return {
    url: `${GITHUB_API_BASE_URL}${path}`,
    init: { headers },
  };
}

/**
 * Web-only helper: fetch a GitHub repo tarball via the unauthenticated REST
 * endpoint. Lives in `apps/web` (not `packages/core`) so the core resolver
 * stays runtime-agnostic and the web bundle does not pull in git libraries.
 * Desktop code paths must NOT import this file; they go through the Tauri
 * shell-backed `git clone` adapter instead.
 *
 * In Vite dev we tunnel through the existing same-origin proxy so the browser
 * never follows GitHub's CORS-hostile redirect to `codeload.github.com`.
 *
 * Returns the raw gzipped tarball bytes; the caller gunzips + untars via
 * `fflate` inside `resolveGitSource`.
 */
export async function fetchGithubTarball(
  owner: string,
  repo: string,
  ref?: string,
): Promise<Uint8Array> {
  const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  const proxyOrigin =
    isDev && typeof window !== 'undefined' ? window.location.origin : undefined;
  const request = buildGithubTarballRequest(owner, repo, ref, { proxyOrigin });
  const resp = await fetch(request.url, request.init);
  if (!resp.ok) {
    throw new Error(`GitHub tarball fetch failed (${resp.status} ${resp.statusText})`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}
