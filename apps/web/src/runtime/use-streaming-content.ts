import { useEffect, useRef, useState } from 'react';
import type { RuntimeEvent, LlmStreamChunkPayload } from '@aics/shared-types';
import { useAicsRuntime } from './aics-runtime-context';

export function useStreamingContent(): { content: string; isStreaming: boolean } {
  const { eventBus, isRunning } = useAicsRuntime();
  const [content, setContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const accRef = useRef('');

  // Reset when a new run starts
  useEffect(() => {
    if (isRunning) {
      accRef.current = '';
      setContent('');
      setIsStreaming(true);
    } else {
      setIsStreaming(false);
    }
  }, [isRunning]);

  useEffect(() => {
    const unsub = eventBus.on('llm.stream.chunk', (event: RuntimeEvent<LlmStreamChunkPayload>) => {
      accRef.current += event.payload.content;
      setContent(accRef.current);
    });
    return unsub;
  }, [eventBus]);

  return { content, isStreaming };
}
