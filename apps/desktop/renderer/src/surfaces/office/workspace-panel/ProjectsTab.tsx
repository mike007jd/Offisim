import type { Project } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { openFirstRunGuide } from '@/surfaces/onboarding/first-run-state.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { Check, FolderGit2, FolderOpen, Pencil, Plus } from 'lucide-react';

export function compactPath(path: string | null | undefined) {
  if (!path) return 'Project folder not chosen';
  return path.replace(/^\/Users\/[^/]+/u, '~');
}

export function ProjectsTab({
  projects,
  activeProjectId,
  isLoading,
  error,
  bindingFolder,
  onRetry,
  onSelect,
  onNew,
  onEdit,
  onBindFolder,
}: {
  projects: Project[];
  activeProjectId: string;
  isLoading: boolean;
  error: unknown;
  bindingFolder: boolean;
  onRetry: () => void;
  onSelect: (project: Project) => void;
  onNew: () => void;
  onEdit: (project: Project) => void;
  onBindFolder: (project: Project) => void;
}) {
  if (isLoading) return <SkeletonRows rows={6} />;
  if (error) {
    return (
      <ErrorState
        title="Projects unavailable"
        detail={
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Project list failed to load.'
        }
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="off-ws-projects">
      <div className="off-ws-projects-actions">
        <button type="button" className="off-ws-project-new off-focusable" onClick={onNew}>
          <Icon icon={Plus} size="sm" />
          New project
        </button>
      </div>
      <div className="off-ws-scroll off-ws-project-scroll">
        <CapsLabel className="px-[var(--off-sp-3)] pb-[var(--off-sp-1)]">
          Projects · {projects.length}
        </CapsLabel>
        {projects.length > 0 ? (
          projects.map((project) => {
            const active = project.id === activeProjectId;
            return (
              <div key={project.id} className={cn('off-ws-project-row', active && 'is-active')}>
                <button
                  type="button"
                  className="off-ws-project-main off-focusable"
                  aria-pressed={active}
                  onClick={() => onSelect(project)}
                >
                  <Icon icon={FolderGit2} size="sm" />
                  <span className="off-ws-project-copy">
                    <span>{project.name}</span>
                    <small>{compactPath(project.workspaceRoot)}</small>
                  </span>
                  {active ? <Icon icon={Check} size="sm" className="off-ws-project-check" /> : null}
                </button>
                <div className="off-ws-project-row-actions">
                  <button
                    type="button"
                    className="off-ws-project-icon off-focusable"
                    onClick={() => onBindFolder(project)}
                    disabled={bindingFolder}
                    title="Change folder"
                  >
                    <Icon icon={FolderOpen} size="sm" />
                  </button>
                  <button
                    type="button"
                    className="off-ws-project-icon off-focusable"
                    onClick={() => onEdit(project)}
                    title="Edit project"
                  >
                    <Icon icon={Pencil} size="sm" />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Create a Project and choose where its files live."
            action={{ label: 'New project', onClick: onNew }}
            secondaryAction={{ label: 'Show setup guide', onClick: openFirstRunGuide }}
          />
        )}
      </div>
    </div>
  );
}
