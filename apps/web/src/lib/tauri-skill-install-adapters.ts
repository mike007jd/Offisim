import type {
  GitCloneAdapter,
  GitLocalFsAdapter,
  LocalDirAdapter,
  VirtualFile,
  VirtualTree,
} from '@offisim/core/browser';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type FsModule = {
  exists: (p: string) => Promise<boolean>;
  mkdir: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  readDir: (p: string) => Promise<Array<{ name: string; isFile?: boolean; isDirectory?: boolean }>>;
  readTextFile: (p: string) => Promise<string>;
  readFile: (p: string) => Promise<Uint8Array>;
  remove: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  stat: (p: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  tempDir?: () => Promise<string>;
  writeFile?: (p: string, data: Uint8Array) => Promise<void>;
};
type PathModule = {
  join: (...parts: string[]) => Promise<string>;
  tempDir: () => Promise<string>;
  homeDir: () => Promise<string>;
};
type ProjectDirEntry = {
  name: string;
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size?: number | null;
};

let invokePromise: Promise<InvokeFn> | null = null;
let fsPromise: Promise<FsModule> | null = null;
let pathPromise: Promise<PathModule> | null = null;

function invoke(): Promise<InvokeFn> {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core').then((m) => m.invoke as InvokeFn);
  }
  return invokePromise;
}
function fs(): Promise<FsModule> {
  if (!fsPromise) {
    fsPromise = import('@tauri-apps/plugin-fs') as unknown as Promise<FsModule>;
  }
  return fsPromise;
}
function path(): Promise<PathModule> {
  if (!pathPromise) {
    pathPromise = import('@tauri-apps/api/path') as unknown as Promise<PathModule>;
  }
  return pathPromise;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function relativeToRoot(absPath: string, root: string): string | null {
  const normalizedPath = normalize(absPath).replace(/\/+$/u, '');
  const normalizedRoot = normalize(root).replace(/\/+$/u, '');
  if (normalizedPath === normalizedRoot) return '.';
  const prefix = `${normalizedRoot}/`;
  if (!normalizedPath.startsWith(prefix)) return null;
  const rel = normalizedPath.slice(prefix.length) || '.';
  // Defense in depth: reject `..` segments so a path like `<root>/../etc/passwd`
  // can't escape the sandbox via project_list_dir / project_read_file.
  if (rel === '..' || rel.startsWith('../') || rel.includes('/../')) return null;
  return rel;
}

async function readTreeRecursive(rootAbs: string): Promise<VirtualTree> {
  const f = await fs();
  const files: VirtualFile[] = [];
  async function walk(abs: string, rel: string): Promise<void> {
    let entries: Array<{ name: string; isFile?: boolean; isDirectory?: boolean }>;
    try {
      entries = await f.readDir(abs);
    } catch {
      // Tauri fs can deny hidden/plugin-managed subdirectories inside otherwise
      // readable trees. Skill scanning only needs the readable subset.
      return;
    }
    for (const e of entries) {
      const entryAbs = `${abs}/${e.name}`;
      const entryRel = rel.length > 0 ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) {
        try {
          await walk(entryAbs, entryRel);
        } catch {
          /* skip unreadable subtree */
        }
      } else if (e.isFile || (!e.isDirectory && e.name.indexOf('.') !== -1)) {
        try {
          const bytes = await f.readFile(entryAbs);
          files.push({ path: entryRel, content: bytes });
        } catch {
          /* skip unreadable entry */
        }
      }
    }
  }
  await walk(normalize(rootAbs), '');
  return { files };
}

async function readProjectTreeRecursive(
  rootAbs: string,
  opts: { projectRoot: string; projectId?: string | undefined },
): Promise<VirtualTree> {
  const inv = await invoke();
  const encoder = new TextEncoder();
  const files: VirtualFile[] = [];
  const rootRel = relativeToRoot(rootAbs, opts.projectRoot);
  if (!rootRel) return { files };
  async function walk(rel: string, outRel: string): Promise<void> {
    let entries: ProjectDirEntry[];
    try {
      entries = await inv<ProjectDirEntry[]>('project_list_dir', {
        path: rel,
        cwd: opts.projectRoot,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel === '.' ? e.name : `${rel}/${e.name}`;
      const childOutRel = outRel.length > 0 ? `${outRel}/${e.name}` : e.name;
      if (e.isDirectory) {
        await walk(childRel, childOutRel);
      } else if (e.isFile) {
        try {
          const text = await inv<string>('project_read_file', {
            path: childRel,
            cwd: opts.projectRoot,
            ...(opts.projectId ? { projectId: opts.projectId } : {}),
          });
          files.push({ path: childOutRel, content: encoder.encode(text) });
        } catch {
          /* skip unreadable or non-text entries */
        }
      }
    }
  }
  await walk(rootRel, '');
  return { files };
}

/**
 * Tauri git clone adapter. Uses the sandboxed `git_exec` invoke handler
 * (whitelisted to `clone` among other subcommands). Clones into a fresh tmp
 * directory under the bound project workspace at `.offisim/tmp/offisim-skill-<rand>/`.
 */
export function createTauriGitCloneAdapter(opts?: {
  projectRoot?: string;
  projectId?: string;
}): GitCloneAdapter {
  return {
    async clone({ url, ref }) {
      if (!opts?.projectRoot || !opts.projectId) {
        throw new Error('Git clone requires a bound project workspace.');
      }
      const tmpBase = `${normalize(opts.projectRoot)}/.offisim/tmp`;
      const randSuffix = Math.random().toString(36).slice(2, 10);
      const tmpPath = `${tmpBase}/offisim-skill-${randSuffix}`;
      const args = ref
        ? ['clone', '--depth', '1', '--branch', ref, url, tmpPath]
        : ['clone', '--depth', '1', url, tmpPath];
      const inv = await invoke();
      const result = await inv<{ ok: boolean; stdout: string; stderr: string }>('git_exec', {
        args,
        cwd: '.',
        projectId: opts.projectId,
      });
      if (!result.ok) {
        throw new Error(`git clone failed: ${result.stderr || 'unknown error'}`);
      }
      return { tmpPath, stderrTail: result.stderr.slice(-400) };
    },
  };
}

export function createTauriGitLocalFsAdapter(opts?: {
  projectRoot?: string;
  projectId?: string;
}): GitLocalFsAdapter {
  return {
    async readTree(localPath) {
      if (opts?.projectRoot && opts.projectId) {
        const tree = await readProjectTreeRecursive(localPath, {
          projectRoot: opts.projectRoot,
          projectId: opts.projectId,
        });
        if (tree.files.length > 0) return tree;
      }
      return readTreeRecursive(localPath);
    },
    async cleanup(localPath) {
      const f = await fs();
      try {
        await f.remove(localPath, { recursive: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

export function createTauriLocalDirAdapter(opts?: {
  projectRoot?: string;
  projectId?: string;
}): LocalDirAdapter {
  const projectRoot = opts?.projectRoot ? normalize(opts.projectRoot) : undefined;
  const projectId = opts?.projectId;
  return {
    async listSubdirs(absPath) {
      const rel = projectRoot ? relativeToRoot(absPath, projectRoot) : null;
      if (rel) {
        const inv = await invoke();
        try {
          const entries = await inv<ProjectDirEntry[]>('project_list_dir', {
            path: rel,
            cwd: projectRoot,
            ...(projectId ? { projectId } : {}),
          });
          return entries.filter((e) => e.isDirectory).map((e) => e.name);
        } catch {
          return [];
        }
      }
      const f = await fs();
      try {
        const entries = await f.readDir(absPath);
        return entries.filter((e) => e.isDirectory).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async readText(absPath) {
      const rel = projectRoot ? relativeToRoot(absPath, projectRoot) : null;
      if (rel) {
        const inv = await invoke();
        return inv<string>('project_read_file', {
          path: rel,
          cwd: projectRoot,
          ...(projectId ? { projectId } : {}),
        });
      }
      const f = await fs();
      return f.readTextFile(absPath);
    },
    resolveHome(relOrAbs) {
      // Tauri plugin-fs tilde expansion is not built in; we expand using homeDir
      // lazily — but the API is async. Callers that need `~` should prepend the
      // home dir before calling. For simplicity here, if the path starts with
      // '~/' we substitute synchronously only when `window.__OFFISIM_HOME__` is
      // pre-populated by the runtime wiring; otherwise return as-is so the
      // caller can fail with a clear error.
      if (!relOrAbs.startsWith('~/')) return relOrAbs;
      const home = (globalThis as { __OFFISIM_HOME__?: string }).__OFFISIM_HOME__;
      return home ? `${home}/${relOrAbs.slice(2)}` : relOrAbs;
    },
    join(...parts) {
      return parts
        .map((p) => normalize(p))
        .join('/')
        .replace(/\/+/g, '/');
    },
  };
}

export async function prefetchTauriHomeDir(): Promise<void> {
  try {
    const p = await path();
    const home = await p.homeDir();
    (globalThis as { __OFFISIM_HOME__?: string }).__OFFISIM_HOME__ = normalize(home);
  } catch {
    /* leave unset; sync resolvers will surface the missing home path */
  }
}
