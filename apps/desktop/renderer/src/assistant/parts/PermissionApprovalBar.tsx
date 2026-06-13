import { Button } from '@/design-system/primitives/button.js';
import { usePendingInteraction } from './usePendingInteraction.js';

/**
 * In-thread HITL approval bar for a pending `permission_request` interaction.
 *
 * The pi kernel routes every employee tool call through the AuditingToolExecutor.
 * When the shell classifier flags a genuinely destructive command (rm -rf, git
 * push, dd, mkfs, …) it raises a `permission_request` via the InteractionService's
 * `requestAndWait` — the long `Tool.execute` await IS the approval wait, no
 * graph interrupt. The shared `usePendingInteraction` hook tracks the request on
 * the runtimeEventBus; on a choice `resolve` resolves the awaiting tool call
 * (approve → the command runs; reject → the boss is told it was blocked).
 */
export function PermissionApprovalBar({
  companyId,
  threadId,
}: {
  companyId: string | null;
  threadId: string;
}) {
  const { pending, submitting, resolve } = usePendingInteraction(
    'permission_request',
    threadId,
    companyId,
  );

  if (!pending || pending.context?.type !== 'permission_request' || !companyId) return null;

  const reason = pending.recommendation?.reason ?? pending.prompt;

  return (
    <section className="off-approvalbar" aria-label="Approve tool access">
      <div className="off-approvalbar-head">
        <span className="off-approvalbar-badge">Approval</span>
        <span className="off-approvalbar-title">{pending.title}</span>
      </div>
      <p className="off-approvalbar-reason">{reason}</p>
      <div className="off-approvalbar-actions">
        {pending.options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option.id === 'approve_once' ? 'default' : 'outline'}
            disabled={submitting}
            onClick={() => resolve(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
