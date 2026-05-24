import type { ProjectRow, ProjectStatus } from '@offisim/shared-types';
import {
  Button,
  EntityDropdown,
  type EntityDropdownItem,
  type EntityDropdownSection,
} from '@offisim/ui-core';
import { Archive, ChevronDown, FolderClosed, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { ProjectSelectedSummary } from './ProjectListPanel.js';

const STATUS_DOT: Record<ProjectStatus, string> = {
  planning: 'bg-accent',
  active: 'bg-ok',
  paused: 'bg-warn',
  completed: 'bg-ink-3',
  archived: 'bg-ink-4',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_CHIP: Record<ProjectStatus, string> = {
  planning: 'text-accent bg-accent-surface border border-accent',
  active: 'text-ok bg-ok-surface border border-ok',
  paused: 'text-warn bg-warn-surface border border-warn',
  completed: 'text-ink-2 bg-surface-2 border border-line',
  archived: 'text-ink-3 bg-surface-2 border border-line-soft',
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
      <span className={`rounded px-1.5 py-0.5 text-fs-micro ${STATUS_CHIP[project.status]}`}>
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
          icon: <Archive className="h-3.5 w-3.5 shrink-0 text-ink-3" />,
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
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 w-full min-w-0 justify-between gap-1.5 rounded-r-pill border-line bg-surface-2 px-3 text-fs-meta text-ink-2 hover:border-line-strong hover:bg-surface-sunken hover:text-ink-1"
      title="Select project context"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderClosed className="size-3.5 flex-shrink-0 text-accent" />
        {activeProject ? (
          <>
            <span
              className={`size-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[activeProject.status]}`}
            />
            <span className="min-w-0 truncate">{activeProject.name}</span>
          </>
        ) : (
          <span className="text-ink-3">All</span>
        )}
      </span>
      <ChevronDown
        className={`size-3 flex-shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </Button>
  );

  return (
    <EntityDropdown
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      align="start"
      collisionPadding={8}
      contentClassName="w-72 max-h-project-select-content overflow-y-auto"
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
