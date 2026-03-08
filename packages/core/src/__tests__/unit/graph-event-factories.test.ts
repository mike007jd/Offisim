import { describe, it, expect } from 'vitest';
import {
  graphNodeEntered,
  graphNodeExited,
  llmStreamChunk,
} from '../../events/event-factories.js';

describe('Phase 2.3 event factories', () => {
  const companyId = 'c-test-1';
  const threadId = 't-test-1';

  describe('graphNodeEntered', () => {
    it('produces correct event shape', () => {
      const event = graphNodeEntered(companyId, threadId, 'boss');
      expect(event.type).toBe('graph.node.entered');
      expect(event.entityId).toBe('boss');
      expect(event.entityType).toBe('graph');
      expect(event.companyId).toBe(companyId);
      expect(event.threadId).toBe(threadId);
      expect(event.payload.nodeName).toBe('boss');
      expect(typeof event.timestamp).toBe('number');
    });
  });

  describe('graphNodeExited', () => {
    it('produces correct event shape', () => {
      const event = graphNodeExited(companyId, threadId, 'manager');
      expect(event.type).toBe('graph.node.exited');
      expect(event.entityId).toBe('manager');
      expect(event.entityType).toBe('graph');
      expect(event.payload.nodeName).toBe('manager');
    });
  });

  describe('llmStreamChunk', () => {
    it('produces correct event shape with content', () => {
      const event = llmStreamChunk(companyId, threadId, 'boss_summary', 'Hello');
      expect(event.type).toBe('llm.stream.chunk');
      expect(event.entityId).toBe('boss_summary');
      expect(event.entityType).toBe('llm');
      expect(event.payload.nodeName).toBe('boss_summary');
      expect(event.payload.content).toBe('Hello');
    });
  });
});
