import { Button } from '@/design-system/primitives/button.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import {
  type InteractionRequest,
  type SkillInstallConfirmInteractionContext,
  skillInstallOutcomeLabel,
} from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * In-thread confirm bar for a pending `skill_install_confirm` interaction
 * (fork / edit / create_skill_from_scratch). The employee's tool call stages a
 * preview through the runtime's InteractionService, which emits
 * `interaction.requested` on the shared runtimeEventBus; this bar renders the
 * preview and, on Confirm, calls `resolveInteraction` so the
 * SkillInstallCommitter writes the SKILL.md to the vault + inserts the skills
 * row. It self-hides when there is no pending skill confirm for this thread.
 *
 * The runtime is per-company and labels interaction events with a placeholder
 * threadId, so this bar routes by the request's OWN `threadId` (carried in the
 * event's request object), not the event's top-level threadId.
 */
export function SkillInstallConfirmBar({
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
      if (!request || request.kind !== 'skill_install_confirm') return;
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

  if (!pending || pending.context?.type !== 'skill_install_confirm' || !companyId) return null;
  const context = pending.context as SkillInstallConfirmInteractionContext;

  const resolve = async (optionId: string) => {
    if (submitting) return;
    setSubmitting(true);
    const interactionId = pending.interactionId;
    try {
      const { getDesktopAgentRuntime } = await import('@/runtime/desktop-agent-runtime.js');
      const runtime = await getDesktopAgentRuntime(companyId);
      const outcome = await runtime.resolveInteraction({
        interactionId,
        selectedOptionId: optionId,
        respondedAt: Date.now(),
      });
      setPending(null);
      if (optionId === 'confirm' && outcome) {
        if (outcome.kind === 'error') {
          toast.error('Skill install failed', { description: outcome.message });
        } else {
          toast.success(skillInstallOutcomeLabel(outcome));
        }
      }
    } catch (error) {
      toast.error('Skill confirm failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const trimmedBody = context.skillMdBody?.trim() ?? '';
  const bodyPreview = trimmedBody.slice(0, 400);
  const bodyTruncated = trimmedBody.length > 400;
  const actionLabel =
    context.action === 'fork' ? 'Fork' : context.action === 'edit' ? 'Edit' : 'Create';

  return (
    <section className="off-skillconfirm" aria-label="Confirm skill change">
      <div className="off-skillconfirm-head">
        <span className="off-skillconfirm-action">{actionLabel} skill</span>
        <span className="off-skillconfirm-name">{context.skillName}</span>
        {context.resolvedEmployeeName ? (
          <span className="off-skillconfirm-target">→ {context.resolvedEmployeeName}</span>
        ) : null}
      </div>
      {context.skillDescription ? (
        <p className="off-skillconfirm-desc">{context.skillDescription}</p>
      ) : null}
      {context.parent ? (
        <p className="off-skillconfirm-parent">
          Forked from <strong>{context.parent.name}</strong> v{context.parent.version}
        </p>
      ) : null}
      {context.allowedTools.length > 0 ? (
        <div className="off-skillconfirm-tools">
          {context.allowedTools.map((tool) => (
            <span key={tool} className="off-skillconfirm-tool">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
      {bodyPreview ? (
        <pre className="off-skillconfirm-body">
          {bodyPreview}
          {bodyTruncated ? '…' : ''}
        </pre>
      ) : null}
      <div className="off-skillconfirm-actions">
        {pending.options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option.id === 'confirm' ? 'default' : 'outline'}
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
