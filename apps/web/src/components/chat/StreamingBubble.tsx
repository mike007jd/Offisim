import { useStreamingContent } from '../../runtime/use-streaming-content';

export function StreamingBubble() {
  const { content, isStreaming } = useStreamingContent();

  if (!isStreaming && !content) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-lg bg-surface-lighter px-4 py-2 text-sm text-text-primary whitespace-pre-wrap">
        {content || '\u00A0'}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-accent animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
