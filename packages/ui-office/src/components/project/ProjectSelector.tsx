import type { ProjectRow, ProjectStatus } from '@offisim/shared-types';
import {
  Badge,
  type BadgeProps,
  Button,
  EntityDropdown,
  type EntityDropdownItem,
  type EntityDropdownSection,
} from '@offisim/ui-core';
import { Archive, ChevronDown, FolderClosed, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { ProjectSelectedSummary } from './ProjectListPanel.js';

const STATUS_DOT: Record<ProjectStatus, string> = {
  planning: 'planning',
  active: 'active',
  paused: 'paused',
  completed: 'completed',
  archived: 'archived',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_CHIP_VARIANT: Record<ProjectStatus, BadgeProps['variant']> = {
  planning: 'info',
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
  archived: 'outline',
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
    icon: <span className="project-selector-status-dot" data-status={STATUS_DOT[project.status]} />,
    badge: (
      <Badge
        variant={STATUS_CHIP_VARIANT[project.status]}
        size="xs"
        className="project-selector-status-badge"
      >
        {STATUS_LABEL[project.status]}
      </Badge>
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
          icon: <Archive data-icon="project-all" />,
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
      className="project-selector-trigger"
      title="Select project context"
    >
      <span data-slot="summary">
        <FolderClosed data-icon="project" />
        {activeProject ? (
          <>
            <span
              className="project-selector-status-dot"
              data-status={STATUS_DOT[activeProject.status]}
            />
            <span data-slot="project-name">{activeProject.name}</span>
          </>
        ) : (
          <span data-slot="all-projects">All</span>
        )}
      </span>
      <ChevronDown data-icon="project-caret" data-open={open ? 'true' : 'false'} />
    </Button>
  );

  return (
    <EntityDropdown
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      align="start"
      collisionPadding={8}
      contentClassName="project-selector-content max-h-project-select-content"
      title={projects.length > 0 ? `Projects · ${projects.length}` : 'Projects'}
      sections={sections}
      activeId={activeProjectId ?? ALL_OPTION_ID}
      onSelect={handleSelect}
      emptyText="No projects yet. Create one below."
      bodyExtras={
        summaryMode === 'compact' && activeProject ? (
          <div className="project-selector-summary">
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
              icon: <FolderPlus data-icon="project-new" />,
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
