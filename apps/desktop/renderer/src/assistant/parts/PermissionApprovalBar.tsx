import { useUiState } from '@/app/ui-state.js';
import { ChatComposerInput } from '@/design-system/grammar/ChatComposerInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { useProjectWorkspaceLeaseReviews } from '@/surfaces/office/board/task-board-data.js';
import { useWorkspaceLeaseDecision } from '@/surfaces/office/board/use-workspace-lease-decision.js';
import {
  reviewWorkspaceLease,
  workspaceLeaseIdFromApprovalTitle,
} from '@/surfaces/office/board/workspace-lease-actions.js';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { conversationRunController } from '../runtime/conversation-run-controller.js';
import {
  useConversationRun,
  usePendingConversationApprovals,
} from '../runtime/conversation-run-react.js';
import { submitPermissionInputOnEnter } from './permission-approval-keyboard.js';

/**
 * In-thread approval bar for Ask mode. The ConversationRunController owns the
 * paused run and persists active/stale interactions; this component only
 * renders the current thread's projection and submits the user's decision.
 */
export function PermissionApprovalBar({ threadId }: { threadId: string }) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const openBoard = useUiState((s) => s.openBoard);
  const highlightBoardRun = useUiState((s) => s.highlightBoardRun);
  const queryClient = useQueryClient();
  usePendingConversationApprovals(companyId || null);
  const { approval } = useConversationRun(threadId);
  const leaseId = approval ? workspaceLeaseIdFromApprovalTitle(approval.title) : null;
  const pendingLeaseAction = useWorkspaceLeaseDecision(leaseId);
  const leaseReviews = useProjectWorkspaceLeaseReviews(projectId && leaseId ? projectId : null);
  const decidingRef = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [answerValue, setAnswerValue] = useState('');
  const approvalKey = approval
    ? `${approval.attemptId}:${approval.uiRequestId}:${approval.state}`
    : 'none';
  const approvalPrefill = approval?.prefill ?? '';

  // Clear any stale decision error whenever a different approval takes over the bar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: approvalKey is an intentionally tracked derived value (stable per approval identity); the callback doesn't reference it directly but must trigger reset on approval change.
  useEffect(() => {
    setDecisionError(null);
    setAnswerValue(approvalPrefill);
  }, [approvalKey, approvalPrefill]);

  if (!approval) return null;

  const stale = approval.state === 'stale';
  const expired = approval.state === 'expired';
  const live = approval.state === 'live';
  const confirmRequest = live && approval.method === 'confirm';
  const selectRequest = live && approval.method === 'select';
  const inputRequest = live && approval.method === 'input';
  const editorRequest = live && approval.method === 'editor';
  const selectOptions = approval.options?.filter((option) => option.trim().length > 0) ?? [];
  const leaseReview = leaseId
    ? (leaseReviews.rows.find((row) => row.leaseId === leaseId) ?? null)
    : null;
  const isLeaseReview = leaseId !== null;
  const leaseDecisionComplete =
    leaseReview?.status === 'merged' || leaseReview?.status === 'discarded';
  // A persisted lease remains safely reviewable after an app restart even
  // though the transient Pi approval envelope is restored as stale. For this
  // card the lease row is the decision authority and the shared idempotent
  // lease action is the only execution path.
  const canAnswer = isLeaseReview ? leaseReview !== null : confirmRequest;
  const lead = isLeaseReview
    ? 'Pending review'
    : expired
      ? 'Approval expired'
      : stale
        ? 'Approval restored'
        : 'Approval needed';

  // Board and the compact notice consume the same lease row. Once either
  // entry point commits a terminal decision, the other must disappear instead
  // of leaving a second actionable-looking approval behind.
  if (isLeaseReview && leaseDecisionComplete) return null;

  const decide = async (answer: {
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }) => {
    if (decidingRef.current) return;
    decidingRef.current = true;
    setDeciding(true);
    setDecisionError(null);
    try {
      if (isLeaseReview) {
        if (!companyId || !leaseReview) throw new Error('The pending lease is still loading.');
        const outcome = await reviewWorkspaceLease(
          leaseReview,
          companyId,
          answer.confirmed ? 'merge' : 'discard',
        );
        toast.success(
          outcome === 'merged'
            ? 'Delegated work merged.'
            : outcome === 'discarded'
              ? 'Delegated work discarded.'
              : 'Delegated review completed by Pi.',
        );
        await queryClient.invalidateQueries({ queryKey: ['workspace-lease-reviews'] });
      } else {
        await conversationRunController.answerApproval({
          threadId,
          attemptId: approval.attemptId,
          hostRequestId: approval.hostRequestId,
          uiRequestId: approval.uiRequestId,
          ...answer,
        });
      }
    } catch (err) {
      console.warn('[PermissionApprovalBar] UI answer failed', err);
      setDecisionError('Could not deliver approval. Retry or stop the run.');
    } finally {
      decidingRef.current = false;
      setDeciding(false);
    }
  };

  const dismiss = () => {
    void conversationRunController.dismissApproval(threadId).catch((err: unknown) => {
      console.warn('[PermissionApprovalBar] dismiss failed', err);
      setDecisionError('Could not dismiss this approval.');
    });
  };

  const openLeaseReview = () => {
    openBoard('board');
    if (leaseReview) highlightBoardRun(leaseReview.rootRunId);
  };

  return (
    <div
      className={`off-permission-bar${isLeaseReview ? ' is-lease-review' : ''}`}
      aria-live="assertive"
      aria-label={isLeaseReview ? 'Pending review' : 'Permission request'}
    >
      <div className="off-permission-head">
        <Icon icon={ShieldAlert} size="sm" className="off-permission-icon" />
        <span className="off-permission-lead">{lead}</span>
        {!isLeaseReview ? <code className="off-permission-tool">{approval.title}</code> : null}
      </div>
      {isLeaseReview ? (
        <p className="off-permission-reason">
          Delegated work is ready. Review its changes in Board or decide here.
        </p>
      ) : approval.message ? (
        <p className="off-permission-reason">{approval.message}</p>
      ) : null}
      {stale && !isLeaseReview ? (
        <p className="off-permission-reason">
          This request was restored after restart and cannot be answered safely.
        </p>
      ) : null}
      {expired ? (
        <p className="off-permission-reason">
          This request expired and can no longer be answered. Dismiss it.
        </p>
      ) : null}
      {decisionError ? <p className="off-permission-error">{decisionError}</p> : null}
      {inputRequest ? (
        <Input
          value={answerValue}
          placeholder={approval.placeholder}
          aria-label={`Response for ${approval.title}`}
          disabled={deciding}
          onChange={(event) => setAnswerValue(event.target.value)}
          onKeyDown={(event) => {
            submitPermissionInputOnEnter(event, decidingRef.current, () => {
              void decide({ value: answerValue });
            });
          }}
        />
      ) : null}
      {editorRequest ? (
        <ChatComposerInput
          value={answerValue}
          placeholder={approval.placeholder}
          aria-label={`Response for ${approval.title}`}
          disabled={deciding}
          rows={4}
          onChange={(event) => setAnswerValue(event.target.value)}
        />
      ) : null}
      <div className="off-permission-actions">
        {isLeaseReview ? (
          <Button
            variant="outline"
            size="sm"
            disabled={deciding || !leaseReview}
            onClick={openLeaseReview}
          >
            Review in Board
          </Button>
        ) : null}
        {canAnswer ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={deciding || pendingLeaseAction !== null || (isLeaseReview && !leaseReview)}
              onClick={() => void decide({ confirmed: false })}
            >
              Reject
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={deciding || pendingLeaseAction !== null || (isLeaseReview && !leaseReview)}
              onClick={() => void decide({ confirmed: true })}
            >
              Approve
            </Button>
          </>
        ) : selectRequest ? (
          <>
            {selectOptions.map((option) => (
              <Button
                key={option}
                variant="outline"
                size="sm"
                disabled={deciding}
                onClick={() => void decide({ value: option })}
              >
                {option}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={deciding}
              onClick={() => void decide({ cancelled: true })}
            >
              Cancel
            </Button>
          </>
        ) : inputRequest || editorRequest ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={deciding}
              onClick={() => void decide({ cancelled: true })}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={deciding}
              onClick={() => void decide({ value: answerValue })}
            >
              Submit
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
