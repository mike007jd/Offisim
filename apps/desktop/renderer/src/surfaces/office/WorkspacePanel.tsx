import { useUiState } from '@/app/ui-state.js';
import { useProjectFiles, useProjects } from '@/data/queries.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { EmptyState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { ChevronRight, FileText, FolderClosed, FolderGit2, RefreshCw } from 'lucide-react';

export function WorkspacePanel() {
  const projectId = useUiState((s) => s.projectId);
  const projects = useProjects(useUiState((s) => s.companyId));
  const files = useProjectFiles(projectId);
  const project = projects.data?.find((p) => p.id === projectId);

  return (
    <aside className="off-ws-panel">
      <div className="off-ws-head">
        <Icon icon={FolderGit2} size="sm" className="off-scope-caret" />
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">{project?.name ?? 'No project'}</span>
          {project?.branch ? <span className="off-ws-crumb-sub">{project.branch}</span> : null}
        </div>
        <div className="ml-auto">
          <IconButton icon={RefreshCw} label="Rescan workspace" size="iconSm" />
        </div>
      </div>

      {project && !project.workspaceRoot ? (
        <EmptyState
          icon={FolderClosed}
          title="No workspace bound"
          description="Bind a local folder to give this project file context for runs."
          action={{ label: 'Bind folder', onClick: () => {} }}
        />
      ) : files.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="off-ws-scroll">
          <CapsLabel className="px-[var(--off-sp-3)] pb-[var(--off-sp-1)]">Files</CapsLabel>
          {files.data?.map((node, index) => (
            <button
              type="button"
              key={`${index}-${node.depth}-${node.name}`}
              className="off-tree-row off-focusable"
              data-depth={node.depth}
            >
              <Icon
                icon={node.kind === 'dir' ? ChevronRight : FileText}
                size="sm"
                className="off-tree-icon"
              />
              {node.name}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
