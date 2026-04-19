import type { InteractionRequest } from '@offisim/shared-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@offisim/ui-core';
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
      <Dialog open>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/95">
          <DialogHeader>
            <DialogTitle className="text-sm text-white">Decision required</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return body;
}

function renderBody(
  request: InteractionRequest,
  employeeName: string | null | undefined,
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void,
) {
  if (request.kind === 'skill_install_confirm' && request.context?.type === 'skill_install_confirm') {
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
