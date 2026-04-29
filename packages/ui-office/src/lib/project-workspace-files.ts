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

async function projectInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isProjectWorkspaceFilesAvailable()) {
    throw new ProjectWorkspaceFilesUnavailableError();
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listProjectWorkspaceDirectory(input: {
  workspaceRoot: string;
  path?: string;
}): Promise<ProjectWorkspaceEntry[]> {
  return projectInvoke<ProjectWorkspaceEntry[]>('project_list_dir', {
    path: input.path ?? '.',
    cwd: input.workspaceRoot,
  });
}

export async function readProjectWorkspaceFile(input: {
  workspaceRoot: string;
  path: string;
}): Promise<string> {
  return projectInvoke<string>('project_read_file', {
    path: input.path,
    cwd: input.workspaceRoot,
  });
}

export function parentWorkspacePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function formatWorkspaceFileSize(size: number | null | undefined): string {
  if (typeof size !== 'number') return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round((size / 1024) * 10) / 10} KB`;
  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}
