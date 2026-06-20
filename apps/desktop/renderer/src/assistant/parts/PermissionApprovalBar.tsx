import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { getDesktopAgentRuntime } from '@/runtime/desktop-agent-runtime.js';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * In-thread approval bar for the "Ask" permission mode. When the agent pauses
 * mid-run to ask the user something it raises a `pendingUiRequest` in the run
 * store; this bar surfaces the prompt's title/message and routes the user's
 * answer back to the paused host through the agent runtime
 * (`runtime.answerUiRequest`) — never a backend-specific command, so the bar
 * stays agent-agnostic. It lives in the chat column next to RunActivityStrip and
 * self-hides when there is no pending prompt. Single-slot by construction: the
 * gated host path runs one tool at a time, so only the active thread's run can
 * have an open prompt.
 *
 * Only `confirm` prompts get Approve/Reject UI today; other UI primitives
 * (select / input / editor) are auto-cancelled upstream so the host never hangs.
 */
export function PermissionApprovalBar() {
  const companyId = useUiState((s) => s.companyId);
  const pending = useRunStore((s) => s.pendingUiRequest);
  const clearPendingUiRequest = useRunStore((s) => s.clearPendingUiRequest);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  if (!pending) return null;

  const decide = async (confirmed: boolean) => {
    setDeciding(true);
    setDecisionError(null);
    try {
      // In the browser preview there is no company-bound runtime/host to answer;
      // just dismiss the prompt. Real desktop runs must deliver the answer first.
      if (companyId) {
        const runtime = await getDesktopAgentRuntime(companyId);
        await runtime.answerUiRequest({ requestId: pending.requestId, id: pending.id, confirmed });
      }
      clearPendingUiRequest();
    } catch (err) {
      console.warn('[PermissionApprovalBar] UI answer failed', err);
      setDecisionError('Could not deliver approval. Retry or stop the run.');
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="off-permission-bar" aria-live="assertive" aria-label="Permission request">
      <div className="off-permission-head">
        <Icon icon={ShieldAlert} size="sm" className="off-permission-icon" />
        <span className="off-permission-lead">Approval needed</span>
        <code className="off-permission-tool">{pending.title}</code>
      </div>
      {pending.message ? <p className="off-permission-reason">{pending.message}</p> : null}
      {decisionError ? <p className="off-permission-error">{decisionError}</p> : null}
      <div className="off-permission-actions">
        <Button
          variant="destructive"
          size="sm"
          disabled={deciding}
          onClick={() => void decide(false)}
        >
          Reject
        </Button>
        <Button variant="default" size="sm" disabled={deciding} onClick={() => void decide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}
