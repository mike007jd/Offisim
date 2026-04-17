import type { RuntimeEvent } from '@offisim/shared-types';
import { truncate } from '../../format-time';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribeLlmChunkStream(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const { lastLlmChunkRef, setCeremony } = ctx;
  let accumulatedBossText = '';
  let currentStreamNode = '';

  const unsubChunk = eventBus.on('llm.stream.chunk', (e: RuntimeEvent) => {
    const payload = e.payload as
      | { nodeName?: string; content?: string; channel?: 'content' | 'reasoning' }
      | undefined;
    if (!payload?.content) return;

    const node = payload.nodeName ?? '';
    const channel = payload.channel ?? 'content';
    if (node !== currentStreamNode) {
      currentStreamNode = node;
      if (node === 'boss_summary' || node === 'boss') {
        accumulatedBossText = '';
      }
    }

    if (node === 'boss_summary' || node === 'boss') {
      if (channel !== 'content') return;
      accumulatedBossText += payload.content;
      lastLlmChunkRef.current = accumulatedBossText;
      const preview = truncate(accumulatedBossText, 50);
      setCeremony((prev) => {
        if (prev.phase !== 'reporting') return prev;
        return { ...prev, bubbleText: preview };
      });
    } else if (node === 'manager') {
      const text =
        payload.content.length > 40 ? `${payload.content.slice(0, 40)}…` : payload.content;
      lastLlmChunkRef.current = text;
    }
  });

  return () => {
    unsubChunk();
  };
}
