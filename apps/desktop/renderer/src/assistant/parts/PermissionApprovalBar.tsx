import { useUiState } from '@/app/ui-state.js';
import { useProjectWorkspaceLeaseReviews } from '@/data/board/task-board-data.js';
import { queryKeys } from '@/data/query-keys.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { useWorkspaceLeaseDecision } from '@/surfaces/office/board/use-workspace-lease-decision.js';
import {
  reviewWorkspaceLease,
  workspaceLeaseIdFromApprovalTitle,
} from '@/surfaces/office/board/workspace-lease-actions.js';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
  const projectId = useUiState((s) => s.projectId);
  const openBoard = useUiState((s) => s.openBoard);
  const highlightBoardRun = useUiState((s) => s.highlightBoardRun);
  const queryClient = useQueryClient();
  usePendingConversationApprovals(companyId || null);
  const { approval } = useConversationRun(threadId);
  const leaseId = approval ? workspaceLeaseIdFromApprovalTitle(approval.title) : null;
  const pendingLeaseAction = useWorkspaceLeaseDecision(leaseId);
  const leaseReviews = useProjectWorkspaceLeaseReviews(projectId && leaseId ? projectId : null);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [inputAnswers, setInputAnswers] = useState<
    Record<string, { value: string; other: boolean }>
  >({});
  const approvalKey = approval
    ? `${approval.attemptId}:${approval.uiRequestId}:${approval.state}`
    : 'none';

  // Clear any stale decision error whenever a different approval takes over the bar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: approvalKey is an intentionally tracked derived value (stable per approval identity); the callback doesn't reference it directly but must trigger reset on approval change.
  useEffect(() => {
    setDecisionError(null);
    setInputAnswers({});
  }, [approvalKey]);

  if (!approval) return null;

  const stale = approval.state === 'stale';
  const expired = approval.state === 'expired';
  const isUserInput = approval.method === 'requestUserInput';
  const leaseReview = leaseId
    ? (leaseReviews.rows.find((row) => row.leaseId === leaseId) ?? null)
    : null;
  const isLeaseReview = leaseId !== null;
  const leaseDecisionComplete =
    leaseReview?.status === 'merged' ||
    leaseReview?.status === 'discarded' ||
    leaseReview?.status === 'failed';
  // A persisted lease remains safely reviewable after an app restart even
  // though the transient agent approval envelope is restored as stale. For this
  // card the lease row is the decision authority and the shared idempotent
  // lease action is the only execution path.
  const canAnswer = isLeaseReview
    ? leaseReview !== null
    : approval.state === 'live' &&
      (approval.method === 'confirm' || approval.method === 'requestUserInput');
  const lead = isLeaseReview
    ? 'Pending review'
    : expired
      ? 'Approval expired'
      : stale
        ? 'Approval restored'
        : isUserInput
          ? 'Question'
          : 'Approval needed';
  const autoResolutionLabel = approval.autoResolutionMs
    ? approval.autoResolutionMs % 60_000 === 0
      ? `${approval.autoResolutionMs / 60_000} min`
      : `${Math.ceil(approval.autoResolutionMs / 1_000)} sec`
    : null;
  const messageRepeatsQuestion = Boolean(
    isUserInput &&
      approval.message &&
      approval.questions?.some((question) => question.question.trim() === approval.message?.trim()),
  );

  // Board and the compact notice consume the same lease row. Once either
  // entry point commits a terminal decision, the other must disappear instead
  // of leaving a second actionable-looking approval behind.
  if (isLeaseReview && leaseDecisionComplete) return null;

  const decide = async (confirmed: boolean) => {
    setDeciding(true);
    setDecisionError(null);
    try {
      if (isLeaseReview) {
        if (!companyId || !leaseReview) throw new Error('The pending lease is still loading.');
        const outcome = await reviewWorkspaceLease(
          leaseReview,
          companyId,
          confirmed ? 'merge' : 'discard',
        );
        toast.success(
          outcome === 'merged'
            ? 'Delegated work merged.'
            : outcome === 'discarded'
              ? 'Delegated work discarded.'
              : 'Delegated review completed.',
        );
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceLeaseReviewsAll() });
      } else {
        await conversationRunController.answerApproval({
          threadId,
          attemptId: approval.attemptId,
          hostRequestId: approval.hostRequestId,
          uiRequestId: approval.uiRequestId,
          confirmed,
        });
      }
    } catch (err) {
      console.warn('[PermissionApprovalBar] UI answer failed', err);
      setDecisionError('Could not deliver approval. Retry or stop the run.');
    } finally {
      setDeciding(false);
    }
  };

  const submitInput = async (cancelled = false) => {
    setDeciding(true);
    setDecisionError(null);
    try {
      const answers = Object.fromEntries(
        (approval.questions ?? []).map((question) => [
          question.id,
          { answers: [inputAnswers[question.id]?.value ?? ''] },
        ]),
      );
      await conversationRunController.answerApproval({
        threadId,
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        ...(cancelled ? { cancelled: true } : { answers }),
      });
    } catch (err) {
      // Do not log answer state: one or more fields may be secret.
      console.warn('[PermissionApprovalBar] input delivery failed');
      setDecisionError(
        err instanceof Error && err.message.includes('Every requested answer')
          ? 'Complete every answer before submitting.'
          : 'Could not deliver your answers. Retry or stop the run.',
      );
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

  const openLeaseReview = () => {
    openBoard('board');
    if (leaseReview) highlightBoardRun(leaseReview.rootRunId);
  };

  return (
    <div
      className={`off-permission-bar${isLeaseReview ? ' is-lease-review' : ''}${
        isUserInput ? ' is-question' : ''
      }`}
      aria-live={isUserInput ? 'polite' : 'assertive'}
      aria-label={isLeaseReview ? 'Pending review' : isUserInput ? 'Question' : 'Approval request'}
    >
      <div className="off-permission-head">
        <Icon
          icon={isUserInput ? MessageCircleQuestion : ShieldAlert}
          size="sm"
          className="off-permission-icon"
        />
        <span className="off-permission-lead">{lead}</span>
        {!isLeaseReview && !isUserInput ? (
          <code className="off-permission-tool">{approval.title}</code>
        ) : null}
      </div>
      {isLeaseReview ? (
        <p className="off-permission-reason">
          Delegated work is ready. Review its changes in Board or decide here.
        </p>
      ) : approval.message && !messageRepeatsQuestion ? (
        <p className="off-permission-reason">{approval.message}</p>
      ) : null}
      {isUserInput && approval.state === 'live' ? (
        <div className="off-permission-questions">
          {(approval.questions ?? []).map((question) => {
            const answer = inputAnswers[question.id] ?? { value: '', other: false };
            return (
              <fieldset className="off-permission-question" key={question.id} disabled={deciding}>
                <legend>{question.header}</legend>
                <p>{question.question}</p>
                {question.options.length ? (
                  <div
                    className="off-permission-options"
                    role="radiogroup"
                    aria-label={question.header}
                  >
                    {question.options.map((option) => {
                      const selected = !answer.other && answer.value === option.label;
                      return (
                        <label
                          className={`off-permission-option${selected ? ' is-selected' : ''}`}
                          key={option.label}
                        >
                          <input
                            type="radio"
                            name={`${approval.uiRequestId}:${question.id}`}
                            value={option.label}
                            checked={selected}
                            aria-checked={selected}
                            onChange={() =>
                              setInputAnswers((current) => ({
                                ...current,
                                [question.id]: { value: option.label, other: false },
                              }))
                            }
                          />
                          <span className="off-permission-option-copy">
                            <strong>{option.label}</strong>
                            {option.description ? <small>{option.description}</small> : null}
                          </span>
                        </label>
                      );
                    })}
                    {question.isOther ? (
                      <label
                        className={`off-permission-option${answer.other ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name={`${approval.uiRequestId}:${question.id}`}
                          value="other"
                          checked={answer.other}
                          aria-checked={answer.other}
                          onChange={() =>
                            setInputAnswers((current) => ({
                              ...current,
                              [question.id]: { value: '', other: true },
                            }))
                          }
                        />
                        <span className="off-permission-option-copy">
                          <strong>Other</strong>
                          <small>Write a different answer</small>
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                {!question.options.length || answer.other ? (
                  <Input
                    type={question.isSecret ? 'password' : 'text'}
                    autoComplete="off"
                    value={answer.value}
                    aria-label={question.header}
                    placeholder={question.isSecret ? 'Enter securely' : 'Type your answer'}
                    onChange={(event) =>
                      setInputAnswers((current) => ({
                        ...current,
                        [question.id]: { value: event.target.value, other: answer.other },
                      }))
                    }
                  />
                ) : null}
              </fieldset>
            );
          })}
        </div>
      ) : null}
      {isUserInput && approval.state === 'live' && autoResolutionLabel ? (
        <p className="off-permission-auto">
          If unanswered, the agent continues automatically after {autoResolutionLabel}.
        </p>
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
        {canAnswer && isUserInput && !isLeaseReview ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={deciding}
              onClick={() => void submitInput(true)}
            >
              Skip
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={deciding}
              onClick={() => void submitInput(false)}
            >
              Answer
            </Button>
          </>
        ) : canAnswer ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={deciding || pendingLeaseAction !== null || (isLeaseReview && !leaseReview)}
              onClick={() => void decide(false)}
            >
              Reject
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={deciding || pendingLeaseAction !== null || (isLeaseReview && !leaseReview)}
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
