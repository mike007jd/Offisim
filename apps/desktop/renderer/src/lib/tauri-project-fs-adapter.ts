import type { FsAdapter } from '@offisim/core/tools';

interface TauriFsAdapterOptions {
  threadId?: string;
  projectId?: string | null;
}

/**
 * `FsAdapter` backed by the sandboxed Tauri `project_*` commands.
 *
 * All project file access on desktop MUST go through these commands — they
 * canonicalize every path and enforce that it resolves inside a bound project
 * `workspace_root` (see `apps/desktop/src-tauri/src/builtin_tools.rs`). We do
 * Pass the active `projectId` whenever the tool context has one; omitting it is
 * reserved for conversations that are genuinely not pinned to a single project.
 *
 * Tauri converts the Rust snake_case `project_id` argument to camelCase
 * `projectId` over IPC, so the JS arg names below match the Rust signatures
 * (`path` / `cwd` / `content` / `projectId`).
 *
 * Hard size ceilings live Rust-side (`MAX_READ_BYTES` = 8 MB,
 * `MAX_WRITE_BYTES` = 8 MB); this adapter never tries to bypass them.
 */
function commandArgs(
  path: string,
  options?: TauriFsAdapterOptions,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const projectId = options?.projectId?.trim();
  if (!projectId) {
    throw new Error(
      'File tools need a bound project workspace. Bind a project folder to this chat before reading or writing files.',
    );
  }
  return {
    path,
    projectId,
    ...(extra ?? {}),
  };
}

export function createTauriProjectFsAdapter(): FsAdapter {
  return {
    async readFile(path: string, options?: TauriFsAdapterOptions): Promise<string> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>('project_read_file', commandArgs(path, options));
    },

    async readFileLines(
      path: string,
      options: TauriFsAdapterOptions & { offset: number; limit?: number },
    ): Promise<string> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>(
        'project_read_file_lines',
        commandArgs(path, options, {
          offset: options.offset,
          ...(options.limit ? { limit: options.limit } : {}),
        }),
      );
    },

    async writeFile(path: string, content: string, options?: TauriFsAdapterOptions): Promise<void> {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<void>('project_write_file', commandArgs(path, options, { content }));
    },

    async exists(path: string, options?: TauriFsAdapterOptions): Promise<boolean> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<boolean>('project_exists', commandArgs(path, options));
    },

    async listDir(path: string, options?: TauriFsAdapterOptions) {
      const { invoke } = await import('@tauri-apps/api/core');
      const rows = await invoke<
        Array<{ name: string; path: string; isFile: boolean; isDirectory: boolean }>
      >('project_list_dir', commandArgs(path, options));
      return rows.map((row) => ({
        name: row.name,
        path: row.path,
        isFile: row.isFile,
        isDirectory: row.isDirectory,
      }));
    },
  };
}
