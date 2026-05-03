import { trimToNull } from '@offisim/shared-types';
import type { ChatThread, ProjectRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  workspaceRoot?: string | null;
}

export class ProjectService {
  constructor(private readonly runtimeCtx: RuntimeContext) {}

  /**
   * Create a new project with one default chat_threads row.
   * Runtime `graph_threads` rows are created lazily via
   * `OrchestrationService.ensureGraphThread()` on first chat send.
   */
  async createProject(input: CreateProjectInput): Promise<{
    project: ProjectRow;
    defaultThread: ChatThread;
  }> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Project name must not be empty');
    }

    const projectId = generateId('proj');
    const companyId = this.runtimeCtx.companyId;

    const project = await this.runtimeCtx.repos.projects.create({
      project_id: projectId,
      company_id: companyId,
      name,
      description: trimToNull(input.description),
      status: 'planning',
      workspace_root: trimToNull(input.workspaceRoot),
    });

    const defaultThread = await this.runtimeCtx.repos.chatThreads.create({
      thread_id: generateId('thread'),
      project_id: projectId,
    });

    return { project, defaultThread };
  }

  async activateProject(projectId: string): Promise<void> {
    await this.runtimeCtx.repos.projects.updateStatus(projectId, 'active');
  }
}
