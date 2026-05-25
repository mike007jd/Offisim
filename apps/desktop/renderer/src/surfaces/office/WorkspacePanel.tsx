import { useUiState } from '@/app/ui-state.js';
import { useGitWorkbench, useProjectFiles, useProjects } from '@/data/queries.js';
import type { GitFileChange, GitWorkbench } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import {
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';

type PanelTab = 'files' | 'git';

const STATUS_GLYPH: Record<GitFileChange['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function FilesTab({
  projectId,
  workspaceRoot,
}: { projectId: string; workspaceRoot: string | null }) {
  const files = useProjectFiles(projectId);
  const [query, setQuery] = useState('');

  if (!workspaceRoot) {
    return (
      <EmptyState
        icon={FolderClosed}
        title="No workspace bound"
        description="Bind a local folder to give this project file context for runs."
        action={{ label: 'Bind folder', onClick: () => {} }}
      />
    );
  }
  if (files.isLoading) return <SkeletonRows rows={6} />;

  const visible = (files.data ?? []).filter((n) =>
    n.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <div className="off-ws-toolbar">
        <span className="off-ws-wsroot" title={workspaceRoot}>
          <Icon icon={FolderOpen} size="sm" />
          {workspaceRoot}
        </span>
        <SearchInput value={query} onChange={setQuery} placeholder="Search files…" />
      </div>
      <div className="off-ws-scroll">
        <CapsLabel className="px-[var(--off-sp-3)] pb-[var(--off-sp-1)]">Files</CapsLabel>
        {visible.map((node, index) => (
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
    </>
  );
}

function GitTab({ workbench }: { workbench: GitWorkbench }) {
  const [staged, setStaged] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(workbench.changes.map((c) => [c.path, c.staged])),
  );
  const stagedCount = Object.values(staged).filter(Boolean).length;

  return (
    <div className="off-gw">
      <div className="off-gw-branch">
        <Icon icon={GitBranch} size="sm" />
        <span className="off-gw-branch-name">{workbench.branch}</span>
        <span className="off-gw-counts">
          ↑{workbench.ahead} ↓{workbench.behind}
        </span>
      </div>

      <div className="off-gw-section">
        <CapsLabel>Changes · {workbench.changes.length}</CapsLabel>
        <div className="off-gw-files">
          {workbench.changes.map((change) => (
            <label key={change.path} className="off-gw-file off-focusable">
              <input
                type="checkbox"
                checked={Boolean(staged[change.path])}
                onChange={(e) =>
                  setStaged((prev) => ({ ...prev, [change.path]: e.target.checked }))
                }
              />
              <span className={cn('off-gw-status', `is-${change.status}`)}>
                {STATUS_GLYPH[change.status]}
              </span>
              <span className="off-gw-path">{change.path}</span>
              <span className="off-gw-stat">
                <span className="off-gw-add">+{change.added}</span>
                <span className="off-gw-rem">−{change.removed}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="off-gw-section">
        <CapsLabel>Diff preview</CapsLabel>
        <pre className="off-gw-diff">
          {workbench.diffPreview.map((line, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
              key={i}
              className={cn('off-gw-diff-line', `is-${line.kind}`)}
            >
              {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
              {line.text}
            </span>
          ))}
        </pre>
      </div>

      <div className="off-gw-checks">
        {workbench.checks.map((check) => (
          <span key={check.id} className={cn('off-gw-check', `is-${check.state}`)}>
            <span className="off-gw-check-dot" />
            {check.label}
          </span>
        ))}
      </div>

      <div className="off-gw-actions">
        <Button variant="subtle" size="sm">
          PR-ready
        </Button>
        <Button variant="default" size="sm" disabled={stagedCount === 0}>
          Commit {stagedCount > 0 ? `(${stagedCount})` : ''}
        </Button>
      </div>
    </div>
  );
}

export function WorkspacePanel() {
  const projectId = useUiState((s) => s.projectId);
  const projects = useProjects(useUiState((s) => s.companyId));
  const git = useGitWorkbench(projectId);
  const project = projects.data?.find((p) => p.id === projectId);
  const [tab, setTab] = useState<PanelTab>('files');

  const tabs = useMemo(
    () =>
      [
        { id: 'files' as const, label: 'Files' },
        { id: 'git' as const, label: 'Git' },
      ] satisfies Array<{ id: PanelTab; label: string }>,
    [],
  );

  return (
    <aside className="off-ws-panel">
      <div className="off-ws-head">
        <div className="off-ws-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={cn('off-ws-tab off-focusable', tab === t.id && 'is-active')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <IconButton icon={RefreshCw} label="Rescan workspace" size="iconSm" />
        </div>
      </div>

      {tab === 'files' ? (
        <FilesTab projectId={projectId} workspaceRoot={project?.workspaceRoot ?? null} />
      ) : git.isLoading ? (
        <SkeletonRows rows={6} />
      ) : git.data ? (
        <GitTab workbench={git.data} />
      ) : (
        <EmptyState
          icon={GitBranch}
          title="No git workspace"
          description="Bind a local folder with a git repository to use the workbench."
        />
      )}
    </aside>
  );
}
