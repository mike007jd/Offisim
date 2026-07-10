import { invokeCommand } from '@/lib/tauri-commands.js';
import type { RuntimeRepositories } from '@offisim/core/browser';

/**
 * Capability-first default workspace.
 *
 * Offisim's builtin file/shell tools are sandbox-jailed to a project's
 * `workspace_root`. Historically a fresh company had zero projects and new
 * projects defaulted to a null `workspace_root`, so a normal chat handed the
 * agent a full toolset that ALL failed closed ("no project workspace_root is
 * bound") — the "running a task and no tool works at all" experience.
 *
 * This module guarantees every company has at least one project bound to a real
 * on-disk directory (a per-company scratch dir under the app's local data dir,
 * provisioned by the Rust `ensure_company_workspace` command). The agent's
 * tools then work the instant a chat opens, while the Rust sandbox keeps jailing
 * every path inside that directory — capability without losing the sandbox.
 * Pointing a chat at a real repo via the Workspace panel remains the upgrade
 * path; it simply overwrites this default binding.
 */

/** Stable name for the auto-provisioned default project, used for idempotency. */
const DEFAULT_WORKSPACE_PROJECT_NAME = 'Default Workspace';

/** Ask Rust to create + canonicalize the per-company scratch workspace dir.
 *  Returns null off-desktop or when the command is unavailable. */
async function provisionCompanyWorkspaceDir(companyId: string): Promise<string | null> {
  try {
    const root = await invokeCommand('ensure_company_workspace', { companyId });
    return root.trim().length > 0 ? root : null;
  } catch (err) {
    console.warn('[ensure-default-workspace] could not provision workspace dir', {
      companyId,
      err,
    });
    return null;
  }
}

function hasBoundRoot(workspaceRoot: string | null | undefined): boolean {
  return (workspaceRoot ?? '').trim().length > 0;
}

/**
 * Ensure the company has a project bound to a real `workspace_root`, returning
 * that project's id. Prefers any already-bound project; otherwise binds (or
 * creates) the `Default Workspace` project to the scratch dir. Returns the first
 * existing project id (or null) if the scratch dir could not be provisioned, so
 * callers degrade rather than throw.
 */
export async function ensureCompanyWorkspaceProjectId(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<string | null> {
  const company = await repos.companies.findById(companyId);
  if (!company) throw new Error(`Company ${companyId} not found.`);

  const projects = await repos.projects.findByCompany(companyId);
  const bound = projects.find((p) => hasBoundRoot(p.workspace_root));
  if (bound) return bound.project_id;

  const root = await provisionCompanyWorkspaceDir(companyId);
  if (!root) return projects[0]?.project_id ?? null;

  const existingDefault = projects.find((p) => p.name === DEFAULT_WORKSPACE_PROJECT_NAME);
  if (existingDefault) {
    await repos.projects.update(existingDefault.project_id, { workspace_root: root });
    return existingDefault.project_id;
  }

  const projectId = crypto.randomUUID();
  await repos.projects.create({
    project_id: projectId,
    company_id: companyId,
    name: DEFAULT_WORKSPACE_PROJECT_NAME,
    description: null,
    status: 'planning',
    workspace_root: root,
  });
  return projectId;
}

/**
 * Make sure the project a chat is scoped to can actually run tools. If the
 * requested project exists but has no `workspace_root`, bind the scratch dir to
 * THAT project in place (keeps thread/project scoping stable). If no project is
 * bound at all, fall back to the company default workspace project. Returns the
 * project id the runtime should scope tools to.
 */
export async function ensureProjectBoundForRun(
  repos: RuntimeRepositories,
  companyId: string,
  requestedProjectId: string | null,
): Promise<string | null> {
  if (requestedProjectId) {
    const project = await repos.projects.findById(requestedProjectId);
    if (project) {
      if (project.company_id !== companyId) {
        throw new Error(`Project ${requestedProjectId} does not belong to company ${companyId}.`);
      }
      if (hasBoundRoot(project.workspace_root)) return requestedProjectId;
      const root = await provisionCompanyWorkspaceDir(companyId);
      if (root) {
        await repos.projects.update(requestedProjectId, { workspace_root: root });
        return requestedProjectId;
      }
    }
  }
  return ensureCompanyWorkspaceProjectId(repos, companyId);
}
