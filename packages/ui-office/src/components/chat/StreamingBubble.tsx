import { useStreamingContent } from '../../runtime/use-streaming-content';

export function StreamingBubble() {
  const { content, isStreaming } = useStreamingContent();

  if (!isStreaming && !content) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap rounded-xl">
        {content || '\u00A0'}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
