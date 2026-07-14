import type { RuntimeRepositories } from '@offisim/core/browser';

/**
 * Validate the Project selected for a work Turn. This intentionally checks only
 * catalog ownership. Workspace availability and recovery are backend authority
 * decisions made for the exact Turn; a stale/missing catalog path must not erase
 * Conversation history or prevent an optional no-files response.
 */
export async function requireProjectWorkspaceForRun(
  repos: RuntimeRepositories,
  companyId: string,
  requestedProjectId: string | null,
): Promise<string> {
  const projectId = requestedProjectId?.trim();
  if (!projectId) {
    throw new Error('Choose a Project and its folder before starting work.');
  }
  const project = await repos.projects.findById(projectId);
  if (!project) throw new Error('The selected Project is unavailable. Choose another Project.');
  if (project.company_id !== companyId) {
    throw new Error('The selected Project is unavailable. Choose another Project.');
  }
  return projectId;
}
