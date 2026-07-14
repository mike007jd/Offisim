import type { RuntimeRepositories } from '@offisim/core/browser';

/**
 * Validate the Project selected for a work Turn. Project selection is explicit:
 * this function never creates a Project, falls back to another Project, or
 * rewrites the Project catalog.
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
  if (!project.workspace_root.trim()) {
    throw new Error('This Project folder is unavailable. Choose it again.');
  }
  return projectId;
}
