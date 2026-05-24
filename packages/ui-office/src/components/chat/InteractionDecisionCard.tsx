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
  employeeName?: string | null;
  onRespond: (selectedOptionId: string, freeformResponse?: string) => Promise<void> | void;
}

export function InteractionDecisionCard({
  request,
  employeeName,
  onRespond,
}: InteractionDecisionCardProps) {
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
    <Card className="border-line bg-surface-1 backdrop-blur-md">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-fs-sm text-ink-1">{request.title}</CardTitle>
          <Badge variant={request.severity === 'high' ? 'error' : 'secondary'}>
            {request.severity === 'high' ? 'High risk' : 'Decision'}
          </Badge>
        </div>
        {employeeName && <span className="text-fs-meta text-ink-3">From: {employeeName}</span>}
        <p className="whitespace-pre-wrap text-fs-meta text-ink-3">{request.prompt}</p>
        {request.recommendation && (
          <div className="rounded-r-sm border border-accent bg-accent-surface px-3 py-2 text-fs-meta text-accent">
            <div className="font-medium">
              Boss recommends:{' '}
              {request.options.find((option) => option.id === request.recommendation?.optionId)
                ?.label ?? request.recommendation.optionId}
            </div>
            <div className="mt-1 text-ink-3">{request.recommendation.reason}</div>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {request.allowFreeformResponse && (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={request.placeholder ?? 'Tell Offisim what to do instead'}
            className="min-h-interaction-note"
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
              {pendingOption === option.id ? 'Working...' : option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
