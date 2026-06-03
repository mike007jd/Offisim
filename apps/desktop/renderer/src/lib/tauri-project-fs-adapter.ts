import type { FsAdapter } from '@offisim/core/tools';

/**
 * `FsAdapter` backed by the sandboxed Tauri `project_*` commands.
 *
 * All project file access on desktop MUST go through these commands — they
 * canonicalize every path and enforce that it resolves inside a bound project
 * `workspace_root` (see `apps/desktop/src-tauri/src/builtin_tools.rs`). We do
 * NOT pass a `projectId`; when omitted the Rust side resolves against the union
 * of every bound project workspace root, which is the right behavior for a
 * direct chat that is not pinned to a single project.
 *
 * Tauri converts the Rust snake_case `project_id` argument to camelCase
 * `projectId` over IPC, so the JS arg names below match the Rust signatures
 * (`path` / `cwd` / `content`).
 *
 * Hard size ceilings live Rust-side (`MAX_READ_BYTES` = 8 MB,
 * `MAX_WRITE_BYTES` = 8 MB); this adapter never tries to bypass them.
 */
export function createTauriProjectFsAdapter(): FsAdapter {
  return {
    async readFile(path: string): Promise<string> {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>('project_read_file', { path });
    },

    async writeFile(path: string, content: string): Promise<void> {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<void>('project_write_file', { path, content });
    },

    async exists(path: string): Promise<boolean> {
      const { invoke } = await import('@tauri-apps/api/core');
      // No dedicated exists command; a successful read proves existence.
      // Any sandbox/IO error (missing file, out-of-bounds path) is treated as
      // "does not exist" for the purposes of this predicate.
      try {
        await invoke<string>('project_read_file', { path });
        return true;
      } catch {
        return false;
      }
    },

    async listDir(path: string) {
      const { invoke } = await import('@tauri-apps/api/core');
      const rows = await invoke<
        Array<{ name: string; path: string; isFile: boolean; isDirectory: boolean }>
      >('project_list_dir', { path });
      return rows.map((row) => ({
        name: row.name,
        path: row.path,
        isFile: row.isFile,
        isDirectory: row.isDirectory,
      }));
    },
  };
}
