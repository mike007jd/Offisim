import type { SopSessionState } from '../types';

interface SopWorkspacePageProps {
  sessionState: SopSessionState;
  onSessionStateChange: (state: SopSessionState) => void;
}

/**
 * Placeholder — will be replaced by the real SopWorkspacePage in Phase 2.
 */
export default function SopWorkspacePage({
  sessionState: _sessionState,
  onSessionStateChange: _onSessionStateChange,
}: SopWorkspacePageProps) {
  return (
    <div data-workspace="sops" data-testid="workspace-sops">
      SOPs Workspace
    </div>
  );
}
