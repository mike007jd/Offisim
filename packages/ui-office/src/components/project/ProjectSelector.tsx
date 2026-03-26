import { ACTIVE_PROJECT_STATUSES, COMPLETED_PROJECT_STATUSES } from '@aics/shared-types';
import type { ProjectRow, ProjectStatus } from '@aics/shared-types';
import { ChevronDown, Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ProjectSelectorProps {
  projects: ProjectRow[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
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

function StatusDot({ status }: { status: ProjectStatus }) {
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />;
}

export function ProjectSelector({ projects, activeProjectId, onSelect }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeProjects = projects.filter((p) =>
    (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(p.status),
  );
  const completedProjects = projects.filter((p) =>
    (COMPLETED_PROJECT_STATUSES as readonly string[]).includes(p.status),
  );

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  function handleSelect(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-7 px-2 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors text-xs text-slate-300"
        title="Select project context"
      >
        <Folder className="h-3 w-3 text-slate-500 flex-shrink-0" />
        {activeProject ? (
          <>
            <StatusDot status={activeProject.status} />
            <span className="max-w-[120px] truncate">{activeProject.name}</span>
          </>
        ) : (
          <span className="text-slate-500">All</span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-slate-600 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[200px] bg-zinc-900 border border-white/10 rounded-lg shadow-2xl py-1 text-xs">
          {/* All option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors ${
              activeProjectId === null ? 'text-white' : 'text-slate-400'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-transparent border border-slate-600 flex-shrink-0" />
            <span>All</span>
            {activeProjectId === null && (
              <span className="ml-auto text-[10px] text-slate-600">active</span>
            )}
          </button>

          {/* Active/planning/paused projects */}
          {activeProjects.length > 0 && (
            <>
              <div className="h-px bg-white/5 my-1" />
              <p className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                Projects
              </p>
              {activeProjects.map((p) => (
                <button
                  key={p.project_id}
                  type="button"
                  onClick={() => handleSelect(p.project_id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors ${
                    p.project_id === activeProjectId ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  <StatusDot status={p.status} />
                  <span className="truncate flex-1 text-left">{p.name}</span>
                  <span
                    className={`text-[10px] flex-shrink-0 ${
                      p.status === 'active'
                        ? 'text-emerald-600'
                        : p.status === 'paused'
                          ? 'text-amber-600'
                          : 'text-blue-600'
                    }`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* Completed/archived projects */}
          {completedProjects.length > 0 && (
            <>
              <div className="h-px bg-white/5 my-1" />
              <p className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                Completed
              </p>
              {completedProjects.map((p) => (
                <button
                  key={p.project_id}
                  type="button"
                  onClick={() => handleSelect(p.project_id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors ${
                    p.project_id === activeProjectId ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  <StatusDot status={p.status} />
                  <span className="truncate flex-1 text-left">{p.name}</span>
                  <span className="text-[10px] text-zinc-600 flex-shrink-0">
                    {STATUS_LABEL[p.status]}
                  </span>
                </button>
              ))}
            </>
          )}

          {projects.length === 0 && (
            <p className="px-3 py-2 text-slate-600 italic">No projects yet</p>
          )}
        </div>
      )}
    </div>
  );
}
