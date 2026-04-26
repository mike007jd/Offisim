import { trimToNull } from '@offisim/shared-types';
import type { ProjectRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId, projectThreadId } from '../utils/generate-id.js';

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  workspaceRoot?: string | null;
}

export class ProjectService {
  constructor(private readonly runtimeCtx: RuntimeContext) {}

  /**
   * Create a new project with its dedicated execution thread.
   * The thread is created first because projects.thread_id has a FK reference to graph_threads.
   */
  async createProject(input: CreateProjectInput): Promise<ProjectRow> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Project name must not be empty');
    }

    const projectId = generateId('proj');
    const threadId = projectThreadId(projectId);
    const companyId = this.runtimeCtx.companyId;

    // Create thread first — projects.thread_id references graph_threads
    await this.runtimeCtx.repos.threads.create({
      thread_id: threadId,
      company_id: companyId,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'queued',
    });

    // Create the project linked to its thread
    const project = await this.runtimeCtx.repos.projects.create({
      project_id: projectId,
      company_id: companyId,
      thread_id: threadId,
      name,
      description: trimToNull(input.description),
      status: 'planning',
      workspace_root: trimToNull(input.workspaceRoot),
    });

    return project;
  }

  async activateProject(projectId: string): Promise<void> {
    await this.runtimeCtx.repos.projects.updateStatus(projectId, 'active');
  }
}
