import type { InteractionRequest } from '@offisim/shared-types';
import { DialogShell } from '@offisim/ui-core';
import { InteractionDecisionCard } from './InteractionDecisionCard';
import { SkillInstallConfirmBubble } from './SkillInstallConfirmBubble';

interface InteractionPromptProps {
  request: InteractionRequest | null;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void;
}

export function InteractionPrompt({ request, employeeName, onRespond }: InteractionPromptProps) {
  if (!request) return null;

  const body = renderBody(request, employeeName, onRespond);

  if (request.severity === 'high') {
    return (
      <DialogShell
        open={true}
        onOpenChange={() => {}}
        size="sm"
        closeOnBackdrop={false}
        closeOnEscape={false}
        title="Decision required"
        className="border-border-default bg-surface-elevated"
      >
        {body}
      </DialogShell>
    );
  }

  return body;
}

function renderBody(
  request: InteractionRequest,
  employeeName: string | null | undefined,
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void,
) {
  if (
    request.kind === 'skill_install_confirm' &&
    request.context?.type === 'skill_install_confirm'
  ) {
    return (
      <SkillInstallConfirmBubble
        request={request}
        context={request.context}
        employeeName={employeeName ?? null}
        onRespond={(id) => onRespond(id)}
      />
    );
  }
  return (
    <InteractionDecisionCard request={request} employeeName={employeeName} onRespond={onRespond} />
  );
}
