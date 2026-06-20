import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { conversationRunController } from '../runtime/conversation-run-controller.js';
import {
  useConversationRun,
  usePendingConversationApprovals,
} from '../runtime/conversation-run-react.js';

/**
 * In-thread approval bar for Ask mode. The ConversationRunController owns the
 * paused run and persists active/stale interactions; this component only
 * renders the current thread's projection and submits the user's decision.
 */
export function PermissionApprovalBar({ threadId }: { threadId: string }) {
  const companyId = useUiState((s) => s.companyId);
  usePendingConversationApprovals(companyId || null);
  const { approval } = useConversationRun(threadId);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const approvalKey = approval
    ? `${approval.attemptId}:${approval.uiRequestId}:${approval.state}`
    : 'none';

  // Clear any stale decision error whenever a different approval takes over the bar.
  useEffect(() => {
    setDecisionError(null);
  }, [approvalKey]);

  if (!approval) return null;

  const stale = approval.state === 'stale';
  const unsupported = approval.state === 'unsupported';
  const canAnswer = approval.state === 'live' && approval.method === 'confirm';
  const lead = stale ? 'Approval expired' : unsupported ? 'Unsupported request' : 'Approval needed';

  const decide = async (confirmed: boolean) => {
    setDeciding(true);
    setDecisionError(null);
    try {
      await conversationRunController.answerApproval({
        threadId,
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed,
      });
    } catch (err) {
      console.warn('[PermissionApprovalBar] UI answer failed', err);
      setDecisionError('Could not deliver approval. Retry or stop the run.');
    } finally {
      setDeciding(false);
    }
  };

  const dismiss = () => {
    void conversationRunController.dismissApproval(threadId).catch((err: unknown) => {
      console.warn('[PermissionApprovalBar] dismiss failed', err);
      setDecisionError('Could not dismiss this approval.');
    });
  };

  return (
    <div className="off-permission-bar" aria-live="assertive" aria-label="Permission request">
      <div className="off-permission-head">
        <Icon icon={ShieldAlert} size="sm" className="off-permission-icon" />
        <span className="off-permission-lead">{lead}</span>
        <code className="off-permission-tool">{approval.title}</code>
      </div>
      {approval.message ? <p className="off-permission-reason">{approval.message}</p> : null}
      {unsupported ? (
        <p className="off-permission-reason">
          This Pi UI primitive was cancelled because Offisim only supports confirm prompts here.
        </p>
      ) : null}
      {stale ? (
        <p className="off-permission-reason">
          This request was restored after restart and cannot be answered safely.
        </p>
      ) : null}
      {decisionError ? <p className="off-permission-error">{decisionError}</p> : null}
      <div className="off-permission-actions">
        {canAnswer ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={deciding}
              onClick={() => void decide(false)}
            >
              Reject
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={deciding}
              onClick={() => void decide(true)}
            >
              Approve
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={deciding} onClick={dismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
