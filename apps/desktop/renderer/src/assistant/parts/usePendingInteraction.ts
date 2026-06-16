import { runtimeEventBus } from '@/runtime/repos.js';
import type {
  InteractionKind,
  InteractionRequest,
  SkillInstallOutcomeKind,
} from '@offisim/shared-types';
import { useEffect, useState } from 'react';

/**
 * Shared subscription + resolve plumbing for an in-thread interaction bar
 * (skill-install confirm, permission approval, …). Each bar passes the
 * interaction `kind` it cares about; the hook tracks the matching pending
 * request for this thread and exposes a `resolve(optionId)` that routes the
 * choice back through the runtime.
 *
 * The runtime is per-company and stamps interaction events with a placeholder
 * threadId, so requests are routed by the request's OWN `threadId` (carried in
 * the event payload), not the event's top-level threadId.
 */
export function usePendingInteraction(
  kind: InteractionKind,
  threadId: string,
  companyId: string | null,
): {
  pending: InteractionRequest | null;
  submitting: boolean;
  resolve: (optionId: string) => Promise<SkillInstallOutcomeKind | null>;
} {
  const [pending, setPending] = useState<InteractionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // A thread switch remounts with a new threadId; drop any stale request.
    setPending(null);
    const readRequest = (event: { payload: unknown }): InteractionRequest | null =>
      (event.payload as { request?: InteractionRequest }).request ?? null;
    const offRequested = runtimeEventBus.on('interaction.requested', (event) => {
      const request = readRequest(event);
      if (!request || request.kind !== kind || request.threadId !== threadId) return;
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
  }, [kind, threadId]);

  const resolve = async (optionId: string): Promise<SkillInstallOutcomeKind | null> => {
    if (submitting || !pending || !companyId) return null;
    setSubmitting(true);
    const { interactionId } = pending;
    try {
      const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
      const runtime = await getDesktopAgentRuntime(companyId);
      const outcome = await runtime.resolveInteraction({
        interactionId,
        selectedOptionId: optionId,
        respondedAt: Date.now(),
      });
      setPending(null);
      return outcome;
    } finally {
      setSubmitting(false);
    }
  };

  return { pending, submitting, resolve };
}
