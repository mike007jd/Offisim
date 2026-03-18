import { cn } from '@aics/ui-core';
import type { ReactNode } from 'react';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

/** Render [N] citation markers as styled superscript badges. */
function renderWithCitations(text: string): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      return (
        <sup
          key={i}
          className="inline-flex items-center justify-center mx-0.5 px-1 min-w-[1.1em] h-4 text-[10px] font-bold rounded bg-blue-500/30 text-blue-200 cursor-default"
          title={`Citation ${match[1]}`}
        >
          {match[1]}
        </sup>
      );
    }
    return part;
  });
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div data-role={role} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] border-2 px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'border-lobster-red bg-lobster-red/20 text-sand'
            : 'border-ocean-light bg-ocean-mid text-sand',
        )}
      >
        {isUser ? content : renderWithCitations(content)}
      </div>
    </div>
  );
}
