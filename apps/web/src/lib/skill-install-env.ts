import type {
  GitCloneAdapter,
  GitHttpFetch,
  GitLocalFsAdapter,
  LocalDirAdapter,
  SkillInstallEnvironment,
  UploadRefResolver,
} from '@offisim/core/browser';
import { buildGithubTarballRequest } from './github-tarball.js';

/**
 * Simple in-memory upload-ref resolver. The chat UI (T2.2 follow-up) can
 * register a user-attached file here before the LLM issues
 * `install_skill_from_upload`; the tool handler then looks up by ref. Refs
 * are consumed on resolve so they can't be reused cross-thread.
 */
export class InMemoryUploadRefResolver implements UploadRefResolver {
  private readonly store = new Map<string, { filename: string; bytes: Uint8Array }>();

  put(ref: string, filename: string, bytes: Uint8Array): void {
    this.store.set(ref, { filename, bytes });
  }

  async resolve(ref: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
    const entry = this.store.get(ref);
    if (!entry) return null;
    this.store.delete(ref);
    return entry;
  }

  has(ref: string): boolean {
    return this.store.has(ref);
  }

  clear(): void {
    this.store.clear();
  }
}

function rewriteGithubTarballFetch(
  url: string,
  init?: { headers?: Record<string, string> },
): { url: string; init?: { headers?: Record<string, string> } } {
  const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  if (!isDev || typeof window === 'undefined') {
    return { url, ...(init ? { init } : {}) };
  }

  const prefix = 'https://api.github.com/repos/';
  if (!url.startsWith(prefix)) {
    return { url, ...(init ? { init } : {}) };
  }

  const rawPath = url.slice('https://api.github.com'.length);
  const match = rawPath.match(/^\/repos\/([^/]+)\/([^/]+)\/tarball(?:\/(.+))?$/u);
  if (!match) {
    return { url, ...(init ? { init } : {}) };
  }

  const [, owner, repo, encodedRef] = match;
  const proxied = buildGithubTarballRequest(owner!, repo!, encodedRef ? decodeURIComponent(encodedRef) : undefined, {
    proxyOrigin: window.location.origin,
  });
  return {
    url: proxied.url,
    init: {
      headers: {
        ...(init?.headers ?? {}),
        ...proxied.init.headers,
      },
    },
  };
}

const httpFetch: GitHttpFetch = async (url, init) => {
  const request = rewriteGithubTarballFetch(url, init);
  const resp = await fetch(request.url, request.init);
  return {
    ok: resp.ok,
    status: resp.status,
    headers: resp.headers,
    arrayBuffer: () => resp.arrayBuffer(),
  };
};

export function createWebSkillInstallEnvironment(opts: {
  uploadResolver: UploadRefResolver;
}): SkillInstallEnvironment {
  return {
    runtime: 'web',
    httpFetch,
    uploadResolver: opts.uploadResolver,
  };
}

export function createTauriSkillInstallEnvironment(opts: {
  clone: GitCloneAdapter;
  gitFs: GitLocalFsAdapter;
  localDir: LocalDirAdapter;
  uploadResolver: UploadRefResolver;
  repoRoot?: string;
}): SkillInstallEnvironment {
  return {
    runtime: 'desktop',
    httpFetch,
    clone: opts.clone,
    gitFs: opts.gitFs,
    localDir: opts.localDir,
    uploadResolver: opts.uploadResolver,
    ...(opts.repoRoot ? { repoRoot: opts.repoRoot } : {}),
  };
}
