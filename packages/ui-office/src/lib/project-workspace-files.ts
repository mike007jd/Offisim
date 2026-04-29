import { isTauri } from './env.js';

export interface ProjectWorkspaceEntry {
  name: string;
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size?: number | null;
}

export class ProjectWorkspaceFilesUnavailableError extends Error {
  constructor(message = 'Project workspace files are available in the desktop app only.') {
    super(message);
    this.name = 'ProjectWorkspaceFilesUnavailableError';
  }
}

export function isProjectWorkspaceFilesAvailable(): boolean {
  return isTauri();
}

export async function listProjectWorkspaceDirectory(input: {
  workspaceRoot: string;
  path?: string;
}): Promise<ProjectWorkspaceEntry[]> {
  if (!isProjectWorkspaceFilesAvailable()) {
    throw new ProjectWorkspaceFilesUnavailableError();
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ProjectWorkspaceEntry[]>('project_list_dir', {
    path: input.path ?? '.',
    cwd: input.workspaceRoot,
  });
}

export async function readProjectWorkspaceFile(input: {
  workspaceRoot: string;
  path: string;
}): Promise<string> {
  if (!isProjectWorkspaceFilesAvailable()) {
    throw new ProjectWorkspaceFilesUnavailableError();
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('project_read_file', {
    path: input.path,
    cwd: input.workspaceRoot,
  });
}
