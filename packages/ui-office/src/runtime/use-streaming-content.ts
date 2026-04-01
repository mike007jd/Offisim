import type {
  GraphNodeEnteredPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';

export function useStreamingContent(): {
  content: string;
  isStreaming: boolean;
  nodeName: string | null;
} {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const [content, setContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const accRef = useRef('');

  // Reset when a new run starts
  useEffect(() => {
    if (isRunning) {
      accRef.current = '';
      setContent('');
      setIsStreaming(true);
      setNodeName(null);
    } else {
      setIsStreaming(false);
    }
  }, [isRunning]);

  // Reset accumulator on each new node entry so only the current streaming
  // node's content is shown. Also track which node is currently streaming.
  useEffect(() => {
    const unsub = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        accRef.current = '';
        setContent('');
        setNodeName(event.payload?.nodeName ?? null);
      },
    );
    return unsub;
  }, [eventBus]);

  useEffect(() => {
    const unsub = eventBus.on('llm.stream.chunk', (event: RuntimeEvent<LlmStreamChunkPayload>) => {
      const chunk = event.payload?.content;
      if (typeof chunk === 'string' && chunk.length > 0) {
        accRef.current += chunk;
        setContent(accRef.current);
      }
    });
    return unsub;
  }, [eventBus]);

  useEffect(() => {
    const unsub = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const payload = event.payload;
        if (payload.status !== 'started' || payload.nodeName !== 'employee') return;
        accRef.current = '';
        setContent('');
      },
    );
    return unsub;
  }, [eventBus]);

  return { content, isStreaming, nodeName };
}
