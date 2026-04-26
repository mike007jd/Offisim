import type { ProjectRow, ProjectStatus } from '@offisim/shared-types';
import { BriefcaseBusiness, ChevronDown, FolderPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ProjectListPanel } from './ProjectListPanel.js';

const STATUS_DOT: Record<ProjectStatus, string> = {
  planning: 'bg-blue-400',
  active: 'bg-emerald-400',
  paused: 'bg-amber-400',
  completed: 'bg-zinc-400',
  archived: 'bg-zinc-600',
};

interface ProjectSelectorProps {
  projects: ProjectRow[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  /** Open the ProjectCreateDialog in create mode. Selector itself doesn't own it. */
  onRequestCreate?: () => void;
  /** Open the ProjectCreateDialog in edit mode for the selected project. */
  onRequestEditProject?: (project: ProjectRow) => void;
}

export function ProjectSelector({
  projects,
  activeProjectId,
  onSelect,
  onRequestCreate,
  onRequestEditProject,
}: ProjectSelectorProps) {
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

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  function handleSelect(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  const isEmpty = projects.length === 0;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10"
        title="Select project context"
      >
        <BriefcaseBusiness className="h-3.5 w-3.5 flex-shrink-0 text-cyan-300/70" />
        {activeProject ? (
          <>
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[activeProject.status]}`}
            />
            <span className="max-w-[120px] truncate">{activeProject.name}</span>
          </>
        ) : (
          <span className="text-slate-500">All</span>
        )}
        <ChevronDown
          className={`h-3 w-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[220px] text-xs">
          {isEmpty ? (
            <div className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-3 shadow-2xl flex flex-col gap-2">
              <p className="text-slate-400 leading-relaxed">
                A project pairs a chat thread with an optional local workspace folder.
              </p>
              {onRequestCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRequestCreate();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-cyan-100 transition-colors hover:bg-cyan-500/25"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Create your first project
                </button>
              )}
            </div>
          ) : (
            <ProjectListPanel
              projects={projects}
              activeProjectId={activeProjectId}
              onSelect={handleSelect}
              onClose={() => setOpen(false)}
              onRequestCreateProject={onRequestCreate}
              onRequestEditProject={onRequestEditProject}
            />
          )}
        </div>
      )}
    </div>
  );
}
