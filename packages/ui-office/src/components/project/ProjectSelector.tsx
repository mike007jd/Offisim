import type { ProjectRow, ProjectStatus } from '@offisim/shared-types';
import {
  EntityDropdown,
  type EntityDropdownItem,
  type EntityDropdownSection,
} from '@offisim/ui-core';
import { Archive, BriefcaseBusiness, ChevronDown, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { ProjectSelectedSummary } from './ProjectListPanel.js';

const STATUS_DOT: Record<ProjectStatus, string> = {
  planning: 'bg-info',
  active: 'bg-success',
  paused: 'bg-warning',
  completed: 'bg-text-muted',
  archived: 'bg-text-disabled',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_CHIP: Record<ProjectStatus, string> = {
  planning: 'text-info bg-info-muted border border-info',
  active: 'text-success bg-success-muted border border-success',
  paused: 'text-warning bg-warning-muted border border-warning',
  completed: 'text-text-secondary bg-surface-muted border border-border-default',
  archived: 'text-text-muted bg-surface-muted border border-border-subtle',
};

const ALL_OPTION_ID = '__all__';

interface ProjectSelectorProps {
  projects: ProjectRow[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  /** Open the ProjectCreateDialog in create mode. Selector itself doesn't own it. */
  onRequestCreate?: () => void;
  /** Open the ProjectCreateDialog in edit mode for the selected project. */
  onRequestEditProject?: (project: ProjectRow) => void;
  /** Toast surface for project folder failures. */
  onProjectError?: (message: string) => void;
  /** Keep workspace file browsing out of transient dropdowns by default. */
  summaryMode?: 'none' | 'compact';
}

function projectItem(project: ProjectRow): EntityDropdownItem {
  return {
    id: project.project_id,
    label: project.name,
    icon: <span className={`mt-1 h-1.5 w-1.5 rounded-full ${STATUS_DOT[project.status]}`} />,
    badge: (
      <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_CHIP[project.status]}`}>
        {STATUS_LABEL[project.status]}
      </span>
    ),
    hint: project.description ?? undefined,
  };
}

export function ProjectSelector({
  projects,
  activeProjectId,
  onSelect,
  onRequestCreate,
  onRequestEditProject,
  onProjectError,
  summaryMode = 'none',
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  const activeProjects = projects.filter((p) =>
    (['planning', 'active', 'paused'] as ProjectStatus[]).includes(p.status),
  );
  const completedProjects = projects.filter((p) =>
    (['completed', 'archived'] as ProjectStatus[]).includes(p.status),
  );

  const sections: EntityDropdownSection[] = [
    {
      items: [
        {
          id: ALL_OPTION_ID,
          label: 'All (no project scope)',
          icon: <Archive className="h-3.5 w-3.5 shrink-0 text-text-muted" />,
        },
      ],
    },
  ];
  if (activeProjects.length > 0) {
    sections.push({ title: 'Active', items: activeProjects.map(projectItem) });
  }
  if (completedProjects.length > 0) {
    sections.push({ title: 'Completed', items: completedProjects.map(projectItem) });
  }

  const handleSelect = (id: string) => {
    onSelect(id === ALL_OPTION_ID ? null : id);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-full border border-border-default bg-surface-muted px-2.5 text-xs text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
      title="Select project context"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <BriefcaseBusiness className="h-3.5 w-3.5 flex-shrink-0 text-info" />
        {activeProject ? (
          <>
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[activeProject.status]}`}
            />
            <span className="min-w-0 truncate">{activeProject.name}</span>
          </>
        ) : (
          <span className="text-text-muted">All</span>
        )}
      </span>
      <ChevronDown
        className={`h-3 w-3 flex-shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
  );

  return (
    <EntityDropdown
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      align="start"
      collisionPadding={8}
      contentClassName="w-72 max-h-[28rem] overflow-y-auto"
      title={projects.length > 0 ? `Projects · ${projects.length}` : 'Projects'}
      sections={sections}
      activeId={activeProjectId ?? ALL_OPTION_ID}
      onSelect={handleSelect}
      emptyText="No projects yet. Create one below."
      bodyExtras={
        summaryMode === 'compact' && activeProject ? (
          <div className="mt-2">
            <ProjectSelectedSummary
              project={activeProject}
              onRequestEdit={onRequestEditProject}
              onError={onProjectError}
              showWorkspaceFiles={false}
            />
          </div>
        ) : null
      }
      footerAction={
        onRequestCreate
          ? {
              label: 'New project',
              icon: <FolderPlus className="h-3.5 w-3.5" />,
              onSelect: () => {
                setOpen(false);
                onRequestCreate();
              },
            }
          : undefined
      }
    />
  );
}
