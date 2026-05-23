import type { ProjectRow } from '@offisim/shared-types';
import { ProjectWorkspaceFiles, useSops } from '@offisim/ui-office/web';
import { FileText, FolderClosed, GitBranch, Workflow } from 'lucide-react';
import { useState } from 'react';
import { GitWorkbench } from '../git/GitWorkbench';
import {
  OfficeRailBody,
  OfficeRailContent,
  OfficeRailEmpty,
  OfficeRailIconSlot,
  OfficeRailPane,
  OfficeRailScroller,
  OfficeRailShell,
  OfficeRailSopButton,
  OfficeRailSopDescription,
  OfficeRailSopList,
  OfficeRailSopMeta,
  OfficeRailSopTitle,
  OfficeRailTabBadge,
  OfficeRailTabButton,
  OfficeRailTabs,
  OfficeRailWorkspaceHeader,
  OfficeRailWorkspacePath,
} from './OfficeShellSurfaces';

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
    <OfficeRailShell>
      <OfficeRailTabs>
        <LeftRailTabButton
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={
            <OfficeRailIconSlot>
              <FileText />
            </OfficeRailIconSlot>
          }
          label="Files"
        />
        <LeftRailTabButton
          active={tab === 'sops'}
          onClick={() => setTab('sops')}
          icon={
            <OfficeRailIconSlot>
              <Workflow />
            </OfficeRailIconSlot>
          }
          label="SOPs"
          badge={sops.length > 0 ? sops.length : undefined}
        />
        <LeftRailTabButton
          active={tab === 'git'}
          onClick={() => setTab('git')}
          icon={
            <OfficeRailIconSlot>
              <GitBranch />
            </OfficeRailIconSlot>
          }
          label="Git"
        />
      </OfficeRailTabs>

      <OfficeRailContent>
        {tab === 'files' ? (
          <OfficeRailPane>
            {workspaceRoot ? (
              <OfficeRailWorkspaceHeader>
                <OfficeRailIconSlot>
                  <FolderClosed aria-hidden="true" />
                </OfficeRailIconSlot>
                <OfficeRailWorkspacePath title={workspaceRoot}>
                  {workspaceRoot}
                </OfficeRailWorkspacePath>
              </OfficeRailWorkspaceHeader>
            ) : null}
            <OfficeRailBody>
              {activeProject ? (
                <ProjectWorkspaceFiles
                  projectId={activeProject.project_id}
                  workspaceRoot={workspaceRoot}
                />
              ) : (
                <OfficeRailEmpty>Select a project to browse its workspace files.</OfficeRailEmpty>
              )}
            </OfficeRailBody>
          </OfficeRailPane>
        ) : null}

        {tab === 'sops' ? (
          <OfficeRailScroller>
            {sops.length === 0 ? (
              <OfficeRailEmpty>No SOPs yet. Build one in the SOPs workspace.</OfficeRailEmpty>
            ) : (
              <OfficeRailSopList>
                {sops.map((sop) => (
                  <li key={sop.sopTemplateId}>
                    <OfficeRailSopButton
                      type="button"
                      onClick={() => onOpenSops(sop.sopTemplateId)}
                    >
                      <OfficeRailSopTitle>{sop.name}</OfficeRailSopTitle>
                      {sop.description ? (
                        <OfficeRailSopDescription>{sop.description}</OfficeRailSopDescription>
                      ) : null}
                      <OfficeRailSopMeta>
                        {sop.stepCount} {sop.stepCount === 1 ? 'step' : 'steps'}
                      </OfficeRailSopMeta>
                    </OfficeRailSopButton>
                  </li>
                ))}
              </OfficeRailSopList>
            )}
          </OfficeRailScroller>
        ) : null}

        {tab === 'git' ? <GitWorkbench activeProject={activeProject} /> : null}
      </OfficeRailContent>
    </OfficeRailShell>
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
    <OfficeRailTabButton
      type="button"
      aria-pressed={active}
      onClick={onClick}
      state={active ? 'active' : 'idle'}
    >
      {icon}
      {label}
      {badge != null ? (
        <OfficeRailTabBadge state={active ? 'active' : 'idle'}>{badge}</OfficeRailTabBadge>
      ) : null}
    </OfficeRailTabButton>
  );
}
