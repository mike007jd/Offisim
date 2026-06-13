import { Button } from '@/design-system/primitives/button.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import type { InteractionRequest } from '@offisim/shared-types';
import { useEffect, useState } from 'react';

/**
 * In-thread HITL approval bar for a pending `permission_request` interaction.
 *
 * The pi kernel routes every employee tool call through the AuditingToolExecutor.
 * When the shell classifier flags a genuinely destructive command (rm -rf, git
 * push, dd, mkfs, …) it raises a `permission_request` via the InteractionService's
 * `requestAndWait` — the long `Tool.execute` await IS the approval wait, no
 * graph interrupt. The service emits `interaction.requested` on the shared
 * runtimeEventBus; this bar renders the prompt and, on a choice, calls
 * `resolveInteraction`, which resolves the awaiting tool call (approve → the
 * command runs; reject → the boss is told it was blocked and adapts).
 *
 * Like the skill-confirm bar, the runtime is per-company and stamps interaction
 * events with a placeholder threadId, so this bar routes by the request's OWN
 * `threadId` (carried in the event's request object), not the event top-level.
 */
export function PermissionApprovalBar({
  companyId,
  threadId,
}: {
  companyId: string | null;
  threadId: string;
}) {
  const [pending, setPending] = useState<InteractionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // A thread switch remounts this with a new threadId; drop any stale request.
    setPending(null);
    const readRequest = (event: { payload: unknown }): InteractionRequest | null => {
      const request = (event.payload as { request?: InteractionRequest }).request;
      return request ?? null;
    };
    const offRequested = runtimeEventBus.on('interaction.requested', (event) => {
      const request = readRequest(event);
      if (!request || request.kind !== 'permission_request') return;
      if (request.threadId !== threadId) return;
      setPending(request);
    });
    const offResolved = runtimeEventBus.on('interaction.resolved', (event) => {
      const request = readRequest(event);
      if (!request || request.threadId !== threadId) return;
      setPending((current) => (current?.interactionId === request.interactionId ? null : current));
    });
    return () => {
      offRequested();
      offResolved();
    };
  }, [threadId]);

  if (!pending || pending.context?.type !== 'permission_request' || !companyId) return null;

  const resolve = async (optionId: string) => {
    if (submitting) return;
    setSubmitting(true);
    const interactionId = pending.interactionId;
    try {
      const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
      const runtime = await getDesktopAgentRuntime(companyId);
      await runtime.resolveInteraction({
        interactionId,
        selectedOptionId: optionId,
        respondedAt: Date.now(),
      });
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  };

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
