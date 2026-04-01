import type { InteractionRequest } from '@offisim/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
} from '@offisim/ui-core';
import { useState } from 'react';

interface InteractionDecisionCardProps {
  request: InteractionRequest;
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void;
}

export function InteractionDecisionCard({ request, onRespond }: InteractionDecisionCardProps) {
  const [note, setNote] = useState('');
  const [pendingOption, setPendingOption] = useState<string | null>(null);

  async function handleRespond(optionId: string) {
    setPendingOption(optionId);
    try {
      await onRespond(optionId, note.trim() ? note.trim() : undefined);
    } finally {
      setPendingOption(null);
    }
  }

  return (
    <Card className="border-white/10 bg-black/30 backdrop-blur-md">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm text-white">{request.title}</CardTitle>
          <Badge variant={request.severity === 'high' ? 'error' : 'secondary'}>
            {request.severity === 'high' ? 'High risk' : 'Decision'}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap text-xs text-slate-300">{request.prompt}</p>
        {request.recommendation && (
          <div className="rounded-md border border-cyan-400/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100/85">
            <div className="font-medium">
              Boss recommends:{' '}
              {request.options.find((option) => option.id === request.recommendation?.optionId)
                ?.label ?? request.recommendation.optionId}
            </div>
            <div className="mt-1 text-cyan-100/65">{request.recommendation.reason}</div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {request.allowFreeformResponse && (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={request.placeholder ?? 'Tell Offisim what to do instead'}
            className="min-h-[88px]"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {request.options.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={option.id.startsWith('reject') ? 'outline' : 'secondary'}
              onClick={() => handleRespond(option.id)}
              disabled={
                pendingOption !== null ||
                (request.kind === 'agent_question' &&
                  option.id !== 'cancel' &&
                  note.trim().length === 0)
              }
            >
              {pendingOption === option.id ? 'Working…' : option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
