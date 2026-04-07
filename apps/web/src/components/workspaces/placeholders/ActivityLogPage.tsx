import type { ActivityLogSessionState } from '../types';

interface ActivityLogPageProps {
  sessionState: ActivityLogSessionState;
  onSessionStateChange: (state: ActivityLogSessionState) => void;
}

/**
 * Placeholder — will be replaced by the real ActivityLogPage in Phase 4.
 */
export default function ActivityLogPage({
  sessionState: _sessionState,
  onSessionStateChange: _onSessionStateChange,
}: ActivityLogPageProps) {
  return (
    <div data-workspace="activity-log" data-testid="workspace-activity-log">
      Activity Log
    </div>
  );
}
