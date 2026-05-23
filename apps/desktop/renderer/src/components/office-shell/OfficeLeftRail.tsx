import type { ProjectRow } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { ProjectWorkspaceFiles, useSops } from '@offisim/ui-office/web';
import { FileText, FolderClosed, GitBranch, Workflow } from 'lucide-react';
import { useState } from 'react';
import { GitWorkbench } from '../git/GitWorkbench';

type LeftRailTab = 'files' | 'sops' | 'git';

interface OfficeLeftRailProps {
  activeProject: ProjectRow | null;
  /** Navigate to the SOPs peer workspace (optionally focusing a template). */
  onOpenSops: (sopTemplateId?: string) => void;
}

/**
 * V3 left rail (296px) — a Files / SOPs / Git tab widget that displaces the
 * employee roster (relocated to the stage Team dock). Files = workspace file tree;
 * SOPs = compact template list that routes to the SOPs peer workspace; Git = the
 * GitWorkbench (moved here from the former right-rail Git tab), showing real local
 * repo state only.
 */
export function OfficeLeftRail({ activeProject, onOpenSops }: OfficeLeftRailProps) {
  const [tab, setTab] = useState<LeftRailTab>('files');
  const { sops } = useSops();
  const workspaceRoot = activeProject?.workspace_root ?? null;

  return (
    <div className="flex h-full flex-col bg-surface-1 text-ink-1">
      <div className="flex h-11 items-center gap-0.5 border-b border-line px-sp-5">
        <LeftRailTabButton
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={<FileText className="size-3.5" />}
          label="Files"
        />
        <LeftRailTabButton
          active={tab === 'sops'}
          onClick={() => setTab('sops')}
          icon={<Workflow className="size-3.5" />}
          label="SOPs"
          badge={sops.length > 0 ? sops.length : undefined}
        />
        <LeftRailTabButton
          active={tab === 'git'}
          onClick={() => setTab('git')}
          icon={<GitBranch className="size-3.5" />}
          label="Git"
        />
      </div>

      <div className="min-h-0 overflow-hidden">
        {tab === 'files' ? (
          <div className="flex h-full min-h-0 flex-col">
            {workspaceRoot ? (
              <div className="flex min-w-0 items-center gap-1.5 px-sp-5 pt-sp-4">
                <FolderClosed className="size-3 shrink-0 text-ink-4" aria-hidden="true" />
                <span className="truncate font-mono text-fs-meta text-ink-3" title={workspaceRoot}>
                  {workspaceRoot}
                </span>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeProject ? (
                <ProjectWorkspaceFiles
                  projectId={activeProject.project_id}
                  workspaceRoot={workspaceRoot}
                />
              ) : (
                <LeftRailEmpty message="Select a project to browse its workspace files." />
              )}
            </div>
          </div>
        ) : null}

        {tab === 'sops' ? (
          <div className="custom-scrollbar h-full overflow-y-auto px-sp-5 py-sp-4">
            {sops.length === 0 ? (
              <LeftRailEmpty message="No SOPs yet. Build one in the SOPs workspace." />
            ) : (
              <ul className="flex flex-col gap-sp-3">
                {sops.map((sop) => (
                  <li key={sop.sopTemplateId}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onOpenSops(sop.sopTemplateId)}
                      className="h-auto w-full flex-col items-stretch rounded-r-md border border-line-soft bg-surface-1 px-sp-5 py-sp-4 text-left shadow-elev-1 transition-all hover:border-line-strong hover:bg-surface-1 hover:shadow-elev-2"
                    >
                      <p className="truncate text-fs-base font-semibold text-ink-1">{sop.name}</p>
                      {sop.description ? (
                        <p className="mt-1 line-clamp-2 text-fs-meta text-ink-3">
                          {sop.description}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-fs-micro font-medium text-ink-4">
                        {sop.stepCount} {sop.stepCount === 1 ? 'step' : 'steps'}
                      </p>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'git' ? <GitWorkbench activeProject={activeProject} /> : null}
      </div>
    </div>
  );
}

function LeftRailTabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-r-sm px-2.5 text-fs-sm font-medium transition-colors',
        active
          ? 'bg-accent-surface font-semibold text-accent'
          : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
      )}
    >
      {icon}
      {label}
      {badge != null ? (
        <span
          className={cn(
            'grid h-4 min-w-5 place-items-center rounded-r-pill px-1.5 text-fs-micro font-bold',
            active ? 'bg-accent/15 text-accent' : 'bg-surface-sunken text-ink-3',
          )}
        >
          {badge}
        </span>
      ) : null}
    </Button>
  );
}

function LeftRailEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-sp-5 text-center">
      <p className="text-fs-meta text-ink-4">{message}</p>
    </div>
  );
}
