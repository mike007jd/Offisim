import type { SopDefinition } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../events/event-bus.js';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import { SopService } from '../services/sop-service.js';
import { assertDefined } from './helpers/fixtures.js';

function makeDefinition(overrides?: Partial<SopDefinition>): SopDefinition {
  return {
    sop_id: 'sop-1',
    name: 'Test SOP',
    description: 'A test SOP',
    steps: [
      {
        step_id: 's1',
        label: 'Research',
        role_slug: 'researcher',
        instruction: 'Do research',
        dependencies: [],
        output_key: 'research_output',
      },
      {
        step_id: 's2',
        label: 'Write',
        role_slug: 'writer',
        instruction: 'Write content',
        dependencies: ['s1'],
        output_key: 'draft',
      },
      {
        step_id: 's3',
        label: 'Review',
        role_slug: 'reviewer',
        instruction: 'Review draft',
        dependencies: ['s2'],
        output_key: 'review',
      },
    ],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('SopService', () => {
  function setup() {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const service = new SopService(repos.sopTemplates, eventBus);
    return { repos, eventBus, service };
  }

  describe('validateDefinition', () => {
    it('accepts valid linear SOP', () => {
      const { service } = setup();
      const result = service.validateDefinition(makeDefinition());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects empty steps', () => {
      const { service } = setup();
      const result = service.validateDefinition(makeDefinition({ steps: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least one step');
    });

    it('rejects duplicate step IDs', () => {
      const { service } = setup();
      const def = makeDefinition({
        steps: [
          {
            step_id: 's1',
            label: 'A',
            role_slug: 'dev',
            instruction: 'do A',
            dependencies: [],
            output_key: 'a',
          },
          {
            step_id: 's1',
            label: 'B',
            role_slug: 'dev',
            instruction: 'do B',
            dependencies: [],
            output_key: 'b',
          },
        ],
      });
      const result = service.validateDefinition(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('rejects unknown dependency', () => {
      const { service } = setup();
      const def = makeDefinition({
        steps: [
          {
            step_id: 's1',
            label: 'A',
            role_slug: 'dev',
            instruction: 'do A',
            dependencies: ['unknown'],
            output_key: 'a',
          },
        ],
      });
      const result = service.validateDefinition(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknown step'))).toBe(true);
    });

    it('rejects cycle', () => {
      const { service } = setup();
      const def = makeDefinition({
        steps: [
          {
            step_id: 's1',
            label: 'A',
            role_slug: 'dev',
            instruction: 'do A',
            dependencies: ['s2'],
            output_key: 'a',
          },
          {
            step_id: 's2',
            label: 'B',
            role_slug: 'dev',
            instruction: 'do B',
            dependencies: ['s1'],
            output_key: 'b',
          },
        ],
      });
      const result = service.validateDefinition(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
    });

    it('rejects empty label/role/instruction', () => {
      const { service } = setup();
      const def = makeDefinition({
        steps: [
          {
            step_id: 's1',
            label: '',
            role_slug: 'dev',
            instruction: 'do',
            dependencies: [],
            output_key: 'a',
          },
        ],
      });
      const result = service.validateDefinition(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('empty label'))).toBe(true);
    });
  });

  describe('getExecutionOrder', () => {
    it('returns correct batches for linear chain', () => {
      const { service } = setup();
      const batches = service.getExecutionOrder(makeDefinition());
      expect(batches).toHaveLength(3);
      expect(batches[0]?.map((s) => s.step_id)).toEqual(['s1']);
      expect(batches[1]?.map((s) => s.step_id)).toEqual(['s2']);
      expect(batches[2]?.map((s) => s.step_id)).toEqual(['s3']);
    });

    it('groups parallel steps in same batch', () => {
      const { service } = setup();
      const def = makeDefinition({
        steps: [
          {
            step_id: 's1',
            label: 'Research',
            role_slug: 'researcher',
            instruction: 'Research',
            dependencies: [],
            output_key: 'r',
          },
          {
            step_id: 's2',
            label: 'Design',
            role_slug: 'ux_designer',
            instruction: 'Design',
            dependencies: [],
            output_key: 'd',
          },
          {
            step_id: 's3',
            label: 'Merge',
            role_slug: 'product_manager',
            instruction: 'Merge results',
            dependencies: ['s1', 's2'],
            output_key: 'm',
          },
        ],
      });
      const batches = service.getExecutionOrder(def);
      expect(batches).toHaveLength(2);
      expect(batches[0]?.map((s) => s.step_id).sort()).toEqual(['s1', 's2']);
      expect(batches[1]?.map((s) => s.step_id)).toEqual(['s3']);
    });
  });

  describe('saveAsTemplate / listTemplates / deleteTemplate', () => {
    it('saves and lists template', async () => {
      const { service } = setup();
      const def = makeDefinition();
      const id = await service.saveAsTemplate('c-1', 'My SOP', 'desc', def, 'thread-1');
      expect(id).toBeTruthy();

      const templates = await service.listTemplates('c-1');
      expect(templates).toHaveLength(1);
      const template = assertDefined(templates[0]);
      expect(template.name).toBe('My SOP');
      expect(JSON.parse(template.definition_json).steps).toHaveLength(3);
    });

    it('deletes template', async () => {
      const { service } = setup();
      const def = makeDefinition();
      const id = await service.saveAsTemplate('c-1', 'My SOP', 'desc', def);
      await service.deleteTemplate(id);
      const templates = await service.listTemplates('c-1');
      expect(templates).toHaveLength(0);
    });

    it('getTemplate returns null for missing', async () => {
      const { service } = setup();
      expect(await service.getTemplate('nonexistent')).toBeNull();
    });

    it('isolates templates by company', async () => {
      const { service } = setup();
      const def = makeDefinition();
      await service.saveAsTemplate('c-1', 'SOP A', 'desc', def);
      await service.saveAsTemplate('c-2', 'SOP B', 'desc', def);
      expect(await service.listTemplates('c-1')).toHaveLength(1);
      expect(await service.listTemplates('c-2')).toHaveLength(1);
    });
  });
});
