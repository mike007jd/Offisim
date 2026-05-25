import { useUiState } from '@/app/ui-state.js';
import { useCompanies, useProjects } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Check, ChevronDown, FolderGit2, FolderOpen, Pencil, Plus } from 'lucide-react';

export function ScopeBar() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setCompany = useUiState((s) => s.setCompany);
  const setProject = useUiState((s) => s.setProject);
  const setSurface = useUiState((s) => s.setSurface);

  const companies = useCompanies();
  const projects = useProjects(companyId);

  const activeCompany = companies.data?.find((c) => c.id === companyId);
  const activeProject = projects.data?.find((p) => p.id === projectId);

  return (
    <div className="off-scope-bar">
      <DropdownMenu>
        <DropdownMenuTrigger className="off-scope-seg off-focusable" aria-label="Switch company">
          {activeCompany ? (
            <span
              className="off-scope-badge"
              style={{
                background: `linear-gradient(150deg, ${activeCompany.accentA}, ${activeCompany.accentB})`,
              }}
            >
              {activeCompany.initials}
            </span>
          ) : null}
          <span className="off-scope-name">{activeCompany?.name ?? 'Select company'}</span>
          <Icon icon={ChevronDown} size="sm" className="off-scope-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Companies</DropdownMenuLabel>
          {companies.data?.map((company) => (
            <DropdownMenuItem key={company.id} onSelect={() => setCompany(company.id)}>
              <span
                className="off-scope-badge"
                style={{
                  background: `linear-gradient(150deg, ${company.accentA}, ${company.accentB})`,
                }}
              >
                {company.initials}
              </span>
              <span className="grow">{company.name}</span>
              {company.id === companyId ? (
                <Check className="size-[14px] text-[var(--off-accent)]" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSurface('lifecycle')}>
            <Plus className="size-[14px]" />
            New company
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="off-scope-divider" aria-hidden>
        /
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger className="off-scope-seg off-focusable" aria-label="Switch project">
          <Icon icon={FolderGit2} size="sm" className="off-scope-caret" />
          <span className="off-scope-name">{activeProject?.name ?? 'No project'}</span>
          <Icon icon={ChevronDown} size="sm" className="off-scope-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.data?.length ? (
            projects.data.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => setProject(project.id)}>
                <FolderGit2 className="size-[14px]" />
                <span className="grow">{project.name}</span>
                {project.id === projectId ? (
                  <Check className="size-[14px] text-[var(--off-accent)]" />
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No projects in this company</DropdownMenuItem>
          )}
          {activeProject ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!activeProject.workspaceRoot}>
                <FolderOpen className="size-[14px]" />
                Open folder
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Pencil className="size-[14px]" />
                Edit project
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Plus className="size-[14px]" />
            New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
