import type {
  GraphNodeEnteredPayload,
  LlmStreamChunkPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';

const VISIBLE_STREAMING_NODES = new Set(['boss', 'boss_summary', 'employee', 'hr']);

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
  const currentNodeRef = useRef<string | null>(null);

  // Reset when a new run starts. A live run does not automatically imply
  // user-visible streaming; we wait until a visible reply node begins.
  useEffect(() => {
    if (isRunning) {
      accRef.current = '';
      setContent('');
      setIsStreaming(false);
      setNodeName(null);
      currentNodeRef.current = null;
    } else {
      setIsStreaming(false);
      setNodeName(null);
      currentNodeRef.current = null;
    }
  }, [isRunning]);

  // Reset accumulator on each new node entry so only the current streaming
  // node's content is shown. Also track which node is currently streaming.
  useEffect(() => {
    const unsub = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        const nextNode = event.payload?.nodeName ?? null;
        accRef.current = '';
        setContent('');
        currentNodeRef.current = nextNode;
        if (nextNode && VISIBLE_STREAMING_NODES.has(nextNode)) {
          setNodeName(nextNode);
          setIsStreaming(true);
          return;
        }
        setNodeName(null);
        setIsStreaming(false);
      },
    );
    return unsub;
  }, [eventBus]);

  useEffect(() => {
    const unsub = eventBus.on('llm.stream.chunk', (event: RuntimeEvent<LlmStreamChunkPayload>) => {
      const chunkNode = event.payload?.nodeName ?? null;
      const chunk = event.payload?.content;
      if (!chunkNode || !VISIBLE_STREAMING_NODES.has(chunkNode)) {
        return;
      }
      if (currentNodeRef.current !== chunkNode) {
        currentNodeRef.current = chunkNode;
        accRef.current = '';
        setContent('');
        setNodeName(chunkNode);
        setIsStreaming(true);
      }
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
        if (
          payload.status !== 'started' ||
          payload.nodeName !== 'employee' ||
          currentNodeRef.current !== 'employee'
        ) {
          return;
        }
        accRef.current = '';
        setContent('');
      },
    );
    return unsub;
  }, [eventBus]);

  return { content, isStreaming, nodeName };
}
