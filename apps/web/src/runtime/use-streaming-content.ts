import type { LlmStreamChunkPayload, RuntimeEvent } from '@aics/shared-types';
import { useEffect, useRef, useState } from 'react';
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

  // Reset accumulator on each new node entry so only the last streaming
  // node's content is shown (typically boss-summary). Without this,
  // intermediate node outputs (boss, manager, employee) would get mixed in.
  useEffect(() => {
    const unsub = eventBus.on('graph.node.entered', () => {
      accRef.current = '';
      setContent('');
    });
    return unsub;
  }, [eventBus]);

  useEffect(() => {
    const unsub = eventBus.on('llm.stream.chunk', (event: RuntimeEvent<LlmStreamChunkPayload>) => {
      accRef.current += event.payload.content;
      setContent(accRef.current);
    });
    return unsub;
  }, [eventBus]);

  return { content, isStreaming };
}
