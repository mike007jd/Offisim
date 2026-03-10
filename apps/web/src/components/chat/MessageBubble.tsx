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
          'max-w-[80%] border-2 px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'border-lobster-red bg-lobster-red/20 text-sand'
            : 'border-ocean-light bg-ocean-mid text-sand',
        )}
      >
        {content}
      </div>
    </div>
  );
}
