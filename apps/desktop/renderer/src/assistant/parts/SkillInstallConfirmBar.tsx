import { Button } from '@/design-system/primitives/button.js';
import {
  type SkillInstallConfirmInteractionContext,
  skillInstallOutcomeLabel,
} from '@offisim/shared-types';
import { toast } from 'sonner';
import { usePendingInteraction } from './usePendingInteraction.js';

/**
 * In-thread confirm bar for a pending `skill_install_confirm` interaction
 * (fork / edit / create_skill_from_scratch). The employee's tool call stages a
 * preview through the runtime's InteractionService, which emits
 * `interaction.requested` on the shared runtimeEventBus; this bar renders the
 * preview and, on Confirm, calls `resolveInteraction` so the
 * SkillInstallCommitter writes the SKILL.md to the vault + inserts the skills
 * row. It self-hides when there is no pending skill confirm for this thread.
 *
 * The shared `usePendingInteraction` hook routes the request by its OWN
 * `threadId` (the runtime stamps events with a placeholder); on Confirm this bar
 * surfaces the install outcome as a toast.
 */
export function SkillInstallConfirmBar({
  companyId,
  threadId,
}: {
  companyId: string | null;
  threadId: string;
}) {
  const { pending, submitting, resolve } = usePendingInteraction(
    'skill_install_confirm',
    threadId,
    companyId,
  );

  if (!pending || pending.context?.type !== 'skill_install_confirm' || !companyId) return null;
  const context = pending.context as SkillInstallConfirmInteractionContext;

  const handleResolve = async (optionId: string) => {
    try {
      const outcome = await resolve(optionId);
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
        <p className="off-skillconfirm-tools">
          <span className="off-skillconfirm-tools-lbl">Allowed tools</span>
          {context.allowedTools.join(', ')}
        </p>
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
            onClick={() => handleResolve(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
