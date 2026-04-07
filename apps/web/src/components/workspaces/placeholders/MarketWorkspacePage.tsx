import type { MarketSessionState } from '../types';

interface MarketWorkspacePageProps {
  sessionState: MarketSessionState;
  onSessionStateChange: (state: MarketSessionState) => void;
}

/**
 * Placeholder — will be replaced by the real MarketWorkspacePage in Phase 3.
 */
export default function MarketWorkspacePage({
  sessionState: _sessionState,
  onSessionStateChange: _onSessionStateChange,
}: MarketWorkspacePageProps) {
  return (
    <div data-workspace="market" data-testid="workspace-market">
      Market Workspace
    </div>
  );
}
