import {
  type ProjectRow,
  type ProjectStatus,
  formatWorkspaceRootHint,
} from '@offisim/shared-types';
import { Archive, FolderOpen, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeliverables } from '../../hooks/useDeliverables';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { ProjectWorkspaceFiles } from './ProjectWorkspaceFiles.js';

interface ProjectListPanelProps {
  projects: ProjectRow[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onClose: () => void;
  /** Open ProjectCreateDialog in create mode. */
  onRequestCreateProject?: () => void;
  /** Open ProjectCreateDialog in edit mode for the given project. */
  onRequestEditProject?: (project: ProjectRow) => void;
}

const STATUS_DOT: Record<ProjectStatus, string> = {
  planning: 'bg-blue-400',
  active: 'bg-emerald-400',
  paused: 'bg-amber-400',
  completed: 'bg-zinc-400',
  archived: 'bg-zinc-600',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_CHIP: Record<ProjectStatus, string> = {
  planning: 'text-blue-400 bg-blue-400/10 border border-blue-400/20',
  active: 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
  paused: 'text-amber-400 bg-amber-400/10 border border-amber-400/20',
  completed: 'text-zinc-400 bg-zinc-400/10 border border-zinc-400/20',
  archived: 'text-zinc-600 bg-zinc-600/10 border border-zinc-600/20',
};

function ProjectCard({
  project,
  isSelected,
  onSelect,
}: {
  project: ProjectRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
        isSelected
          ? 'border-white/15 bg-white/8'
          : 'border-white/5 bg-white/3 hover:border-white/10 hover:bg-white/5'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[project.status]}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium truncate ${
                isSelected ? 'text-white' : 'text-slate-300'
              }`}
            >
              {project.name}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${STATUS_CHIP[project.status]}`}
            >
              {STATUS_LABEL[project.status]}
            </span>
          </div>
          {project.description && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{project.description}</p>
          )}
        </div>
      </div>
    </button>
  );
}

function ProjectSelectedSummary({
  project,
  onRequestEdit,
}: {
  project: ProjectRow;
  onRequestEdit?: (project: ProjectRow) => void;
}) {
  const { repos } = useOffisimRuntime();
  const allDeliverables = useDeliverables();
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const threadId = project.thread_id;

  useEffect(() => {
    if (!threadId || !repos?.taskRuns) {
      setTaskCount(null);
      return;
    }
    let cancelled = false;
    void repos.taskRuns.findByThread(threadId).then((rows) => {
      if (!cancelled) setTaskCount(rows.length);
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, repos]);

  const deliverableCount = useMemo(() => {
    if (!threadId) return 0;
    return allDeliverables.filter((d) => d.threadId === threadId).length;
  }, [allDeliverables, threadId]);

  return (
    <div className="mt-2 px-3 py-2 rounded-lg border border-white/8 bg-white/3 flex flex-col gap-2 text-[11px] text-slate-400">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-600">
          Workspace folder
        </span>
        <span
          className={project.workspace_root ? 'text-slate-200' : 'text-slate-500'}
          title={project.workspace_root ?? undefined}
        >
          {formatWorkspaceRootHint(project.workspace_root)}
        </span>
      </div>
      <div className="flex items-center gap-3 text-slate-400">
        <span>
          <span className="text-slate-200 font-medium">{taskCount ?? '—'}</span> tasks
        </span>
        <span>
          <span className="text-slate-200 font-medium">{deliverableCount}</span> deliverables
        </span>
      </div>
      {onRequestEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onRequestEdit(project)}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10"
          >
            <Pencil className="h-3 w-3" />
            Edit project
          </button>
        </div>
      )}
      <ProjectWorkspaceFiles workspaceRoot={project.workspace_root} />
    </div>
  );
}

export function ProjectListPanel({
  projects,
  activeProjectId,
  onSelect,
  onClose,
  onRequestCreateProject,
  onRequestEditProject,
}: ProjectListPanelProps) {
  const activeProjects = projects.filter((p) =>
    (['planning', 'active', 'paused'] as ProjectStatus[]).includes(p.status),
  );
  const completedProjects = projects.filter((p) =>
    (['completed', 'archived'] as ProjectStatus[]).includes(p.status),
  );

  const selectedProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  return (
    <div className="w-72 bg-zinc-900/95 backdrop-blur-sm border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-300">Projects</span>
          {projects.length > 0 && (
            <span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
              {projects.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-600 hover:text-slate-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-96">
        {/* All / no project option */}
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            onClose();
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors ${
            activeProjectId === null
              ? 'border-white/15 bg-white/8 text-white'
              : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/5'
          }`}
        >
          <Archive className="h-3.5 w-3.5 flex-shrink-0" />
          <span>All (no project scope)</span>
        </button>

        {/* Active/planning/paused */}
        {activeProjects.length > 0 && (
          <div className="space-y-1">
            <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-slate-700">Active</p>
            {activeProjects.map((p) => (
              <ProjectCard
                key={p.project_id}
                project={p}
                isSelected={p.project_id === activeProjectId}
                onSelect={() => {
                  onSelect(p.project_id);
                }}
              />
            ))}
          </div>
        )}

        {/* Completed/archived */}
        {completedProjects.length > 0 && (
          <div className="space-y-1">
            <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-slate-700">
              Completed
            </p>
            {completedProjects.map((p) => (
              <ProjectCard
                key={p.project_id}
                project={p}
                isSelected={p.project_id === activeProjectId}
                onSelect={() => {
                  onSelect(p.project_id);
                }}
              />
            ))}
          </div>
        )}

        {projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-slate-700">
            <FolderOpen className="h-6 w-6 mb-2 opacity-40" />
            <p className="text-xs italic">No projects yet</p>
            <p className="text-[11px] mt-1 text-slate-800">
              Create one from the project picker in the header.
            </p>
          </div>
        )}

        {selectedProject && (
          <ProjectSelectedSummary project={selectedProject} onRequestEdit={onRequestEditProject} />
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-white/5">
        {onRequestCreateProject ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onRequestCreateProject();
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-blue-400 transition-colors hover:bg-white/5"
          >
            <Plus className="h-3 w-3" />
            <span>New project</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-700">
            <Plus className="h-3 w-3" />
            <span>Use the picker to create a new project</span>
          </div>
        )}
      </div>
    </div>
  );
}
