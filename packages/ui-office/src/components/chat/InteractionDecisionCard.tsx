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
    <Card className="interaction-decision-card">
      <CardHeader className="interaction-decision-head">
        <div className="interaction-decision-title-row">
          <CardTitle className="interaction-decision-title">{request.title}</CardTitle>
          <Badge variant={request.severity === 'high' ? 'error' : 'secondary'}>
            {request.severity === 'high' ? 'High risk' : 'Decision'}
          </Badge>
        </div>
        {employeeName && <span className="interaction-decision-source">From: {employeeName}</span>}
        <p className="interaction-decision-prompt">{request.prompt}</p>
        {request.recommendation && (
          <div className="interaction-decision-recommendation">
            <div>
              Boss recommends:{' '}
              {request.options.find((option) => option.id === request.recommendation?.optionId)
                ?.label ?? request.recommendation.optionId}
            </div>
            <div>{request.recommendation.reason}</div>
          </div>
        )}
      </CardHeader>
      <CardContent className="interaction-decision-body">
        {request.allowFreeformResponse && (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={request.placeholder ?? 'Tell Offisim what to do instead'}
            className="interaction-decision-note"
          />
        )}
        <div className="interaction-decision-actions">
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
