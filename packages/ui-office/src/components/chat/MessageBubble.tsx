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
          'max-w-[80%] px-3 py-1.5 text-sm leading-snug whitespace-pre-wrap rounded-xl',
          isUser
            ? 'bg-blue-600/20 text-slate-100'
            : 'bg-white/5 text-slate-200',
        )}
      >
        {isUser ? content : renderWithCitations(content)}
      </div>
    </div>
  );
}
