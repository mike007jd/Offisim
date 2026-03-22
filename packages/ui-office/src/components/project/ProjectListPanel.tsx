import { Archive, FolderOpen, Plus, X } from 'lucide-react';
import type { ProjectRow, ProjectStatus } from '@aics/shared-types';

interface ProjectListPanelProps {
  projects: ProjectRow[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  onClose: () => void;
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
            <p className="text-[11px] text-slate-600 truncate mt-0.5">{project.description}</p>
          )}
          {project.thread_id && (
            <p className="text-[10px] text-slate-700 font-mono mt-0.5 truncate">
              thread: {project.thread_id.slice(0, 16)}…
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function ProjectListPanel({
  projects,
  activeProjectId,
  onSelect,
  onClose,
}: ProjectListPanelProps) {
  const activeProjects = projects.filter((p) =>
    (['planning', 'active', 'paused'] as ProjectStatus[]).includes(p.status),
  );
  const completedProjects = projects.filter((p) =>
    (['completed', 'archived'] as ProjectStatus[]).includes(p.status),
  );

  return (
    <div className="w-72 bg-zinc-900/95 backdrop-blur-sm border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-300">Projects</span>
          {projects.length > 0 && (
            <span className="text-[10px] text-slate-600 bg-white/5 px-1.5 py-0.5 rounded">
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
      <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-80">
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
            <p className="px-2 pt-1 text-[10px] uppercase tracking-wider text-slate-700">
              Active
            </p>
            {activeProjects.map((p) => (
              <ProjectCard
                key={p.project_id}
                project={p}
                isSelected={p.project_id === activeProjectId}
                onSelect={() => {
                  onSelect(p.project_id);
                  onClose();
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
                  onClose();
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
              Ask the Boss to create a project
            </p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-white/5 flex items-center gap-1.5 text-[10px] text-slate-700">
        <Plus className="h-3 w-3" />
        <span>Tell the Boss to create a new project</span>
      </div>
    </div>
  );
}
