import type { InteractionRequest } from '@offisim/shared-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@offisim/ui-core';
import { InteractionDecisionCard } from './InteractionDecisionCard';

interface InteractionPromptProps {
  request: InteractionRequest | null;
  employeeName?: string | null;
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void;
}

export function InteractionPrompt({ request, employeeName, onRespond }: InteractionPromptProps) {
  if (!request) return null;

  if (request.severity === 'high') {
    return (
      <Dialog open>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/95">
          <DialogHeader>
            <DialogTitle className="text-sm text-white">Decision required</DialogTitle>
          </DialogHeader>
          <InteractionDecisionCard
            request={request}
            employeeName={employeeName}
            onRespond={onRespond}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <InteractionDecisionCard request={request} employeeName={employeeName} onRespond={onRespond} />
  );
}
