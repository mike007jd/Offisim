import { describe, expect, it, beforeEach } from 'vitest';
import type { RuntimeEvent } from '@aics/shared-types';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { InMemoryMemoryRepository } from '../../repositories/memory-memory-repository.js';
import { MemoryService } from '../../services/memory-service.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

const COMPANY_ID = 'c-test-1';
const EMPLOYEE_ID = 'e-dev-1';
const THREAD_ID = 't-test-1';

describe('MemoryService', () => {
  let memoryRepo: InMemoryMemoryRepository;
  let gateway: MockLlmGateway;
  let eventBus: InMemoryEventBus;
  let service: MemoryService;
  // biome-ignore lint/suspicious/noExplicitAny: event collector
  let events: RuntimeEvent<any>[];

  beforeEach(() => {
    memoryRepo = new InMemoryMemoryRepository();
    gateway = new MockLlmGateway();
    eventBus = new InMemoryEventBus();
    service = new MemoryService(memoryRepo, gateway, eventBus);
    events = [];
    eventBus.on('', (e) => events.push(e));
  });

  describe('getRelevantMemories', () => {
    it('returns memories from all 3 scopes merged and deduplicated', async () => {
      // Employee scope
      await memoryRepo.create({
        memory_id: 'mem-emp',
        company_id: COMPANY_ID,
        scope: 'employee',
        owner_id: EMPLOYEE_ID,
        category: 'experience',
        content: 'learned about testing patterns',
        importance: 0.8,
      });
      // Team scope
      await memoryRepo.create({
        memory_id: 'mem-team',
        company_id: COMPANY_ID,
        scope: 'team',
        owner_id: COMPANY_ID,
        category: 'decision',
        content: 'team decided to use testing-library',
        importance: 0.6,
      });
      // Company scope
      await memoryRepo.create({
        memory_id: 'mem-co',
        company_id: COMPANY_ID,
        scope: 'company',
        owner_id: COMPANY_ID,
        category: 'knowledge',
        content: 'company testing guidelines require 80% coverage',
        importance: 0.9,
      });

      const results = await service.getRelevantMemories(
        EMPLOYEE_ID,
        COMPANY_ID,
        'testing',
        10,
      );
      expect(results).toHaveLength(3);
      // Should be sorted by importance * recency (all same recency, so by importance)
      expect(results[0]!.memory_id).toBe('mem-co');
      expect(results[1]!.memory_id).toBe('mem-emp');
      expect(results[2]!.memory_id).toBe('mem-team');
    });

    it('deduplicates memories that appear in multiple scope searches', async () => {
      // A company-scope memory with companyId as both ownerId
      await memoryRepo.create({
        memory_id: 'mem-dup',
        company_id: COMPANY_ID,
        scope: 'company',
        owner_id: COMPANY_ID,
        category: 'knowledge',
        content: 'duplicate info',
        importance: 0.5,
      });

      const results = await service.getRelevantMemories(
        EMPLOYEE_ID,
        COMPANY_ID,
        'duplicate',
        10,
      );
      // Should appear only once despite matching in company scope search
      const ids = results.map((r) => r.memory_id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await memoryRepo.create({
          memory_id: `mem-${i}`,
          company_id: COMPANY_ID,
          scope: 'employee',
          owner_id: EMPLOYEE_ID,
          category: 'experience',
          content: `fact number ${i}`,
          importance: 0.5,
        });
      }

      const results = await service.getRelevantMemories(
        EMPLOYEE_ID,
        COMPANY_ID,
        'fact',
        2,
      );
      expect(results).toHaveLength(2);
    });

    it('returns empty array when no memories match', async () => {
      const results = await service.getRelevantMemories(
        EMPLOYEE_ID,
        COMPANY_ID,
        'nonexistent',
        10,
      );
      expect(results).toHaveLength(0);
    });
  });

  describe('reflectAndRemember', () => {
    it('extracts memories from LLM response and creates entries', async () => {
      const extractedJson = JSON.stringify({
        memories: [
          {
            content: 'Always validate input before processing',
            category: 'experience',
            scope: 'employee',
            importance: 0.7,
          },
          {
            content: 'The auth service requires Bearer tokens',
            category: 'knowledge',
            scope: 'team',
            importance: 0.6,
          },
        ],
      });
      gateway.pushResponse({ content: extractedJson });

      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'I fixed a bug where input was not validated before calling the auth service.',
        THREAD_ID,
      );

      // Should create 2 memory entries
      const empMemories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(empMemories).toHaveLength(1);
      expect(empMemories[0]!.content).toBe('Always validate input before processing');

      const teamMemories = await memoryRepo.findByOwner(COMPANY_ID, { category: 'knowledge' });
      expect(teamMemories).toHaveLength(1);

      // Should emit 2 memory.created events
      const memEvents = events.filter((e) => e.type === 'memory.created');
      expect(memEvents).toHaveLength(2);
    });

    it('skips when opts.skip is true', async () => {
      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'Some task content',
        THREAD_ID,
        { skip: true },
      );

      const allMemories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(allMemories).toHaveLength(0);
    });

    it('handles LLM returning empty memories array', async () => {
      gateway.pushResponse({ content: '{ "memories": [] }' });

      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'trivial task',
        THREAD_ID,
      );

      const allMemories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(allMemories).toHaveLength(0);
    });

    it('handles LLM returning JSON in markdown code block', async () => {
      const json = JSON.stringify({
        memories: [
          {
            content: 'Code blocks work',
            category: 'experience',
            scope: 'employee',
            importance: 0.5,
          },
        ],
      });
      gateway.pushResponse({ content: `\`\`\`json\n${json}\n\`\`\`` });

      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'task with code block response',
        THREAD_ID,
      );

      const memories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(memories).toHaveLength(1);
      expect(memories[0]!.content).toBe('Code blocks work');
    });

    it('handles invalid LLM response gracefully (no crash)', async () => {
      gateway.pushResponse({ content: 'This is not JSON at all' });

      // Should not throw
      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'task content',
        THREAD_ID,
      );

      const memories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(memories).toHaveLength(0);
    });

    it('handles invalid Zod schema gracefully', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          memories: [{ content: '', category: 'invalid_cat', scope: 'employee', importance: 2.0 }],
        }),
      });

      // Should not throw
      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'task content',
        THREAD_ID,
      );

      const memories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(memories).toHaveLength(0);
    });

    it('sets correct owner_id based on scope', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          memories: [
            {
              content: 'Personal learning',
              category: 'experience',
              scope: 'employee',
              importance: 0.5,
            },
            {
              content: 'Company policy',
              category: 'decision',
              scope: 'company',
              importance: 0.8,
            },
          ],
        }),
      });

      await service.reflectAndRemember(
        EMPLOYEE_ID,
        COMPANY_ID,
        'task content',
        THREAD_ID,
      );

      const empMemories = await memoryRepo.findByOwner(EMPLOYEE_ID);
      expect(empMemories).toHaveLength(1);
      expect(empMemories[0]!.scope).toBe('employee');

      const coMemories = await memoryRepo.findByOwner(COMPANY_ID, { category: 'decision' });
      expect(coMemories).toHaveLength(1);
      expect(coMemories[0]!.scope).toBe('company');
    });
  });
});
