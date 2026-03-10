import { cn } from '../../lib/utils';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div data-role={role} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap',
          isUser ? 'bg-accent text-white' : 'bg-surface-lighter text-text-primary',
        )}
      >
        {content}
      </div>
    </div>
  );
}
