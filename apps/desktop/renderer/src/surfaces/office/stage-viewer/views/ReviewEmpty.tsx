import { useUiState } from '@/app/ui-state.js';
import { useGitWorkbench } from '@/data/queries.js';
import { Button } from '@/design-system/primitives/button.js';
import { StageEmpty } from '@/surfaces/office/stage-preview/StageEmpty.js';
import { GitCompareArrows } from 'lucide-react';

/** Review-tab empty state that mirrors the workspace Git panel: a valid folder
 *  that is not yet a repo (or a missing folder) points at the Git tab where the
 *  Initialize/Rebind actions live, instead of a generic "no changes" message
 *  that cannot tell non-repo from a clean tree. */
export function ReviewEmpty() {
  const projectId = useUiState((s) => s.projectId);
  const setLeftRailCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const openBoard = useUiState((s) => s.openBoard);
  const git = useGitWorkbench(projectId);
  const showWorkspaceGit = (
    <Button variant="subtle" size="sm" onClick={() => setLeftRailCollapsed(false)}>
      Show workspace Git
    </Button>
  );
  if (git.data?.status === 'uninitialized') {
    return (
      <StageEmpty
        icon={GitCompareArrows}
        title="Not a git repository yet"
        detail="Initialize a repository from the Git tab in the workspace rail to review diffs here."
        action={showWorkspaceGit}
      />
    );
  }
  if (git.data?.status === 'invalid-folder') {
    return (
      <StageEmpty
        icon={GitCompareArrows}
        title="Workspace folder not found"
        detail="Rebind this project to a folder that exists from the Git tab in the workspace rail."
        action={showWorkspaceGit}
      />
    );
  }
  return (
    <StageEmpty
      icon={GitCompareArrows}
      title="No changes to review"
      detail="Git diffs and changed files will appear here when the workspace changes."
      action={
        <Button variant="subtle" size="sm" onClick={() => openBoard('board')}>
          Open request board
        </Button>
      }
    />
  );
}
