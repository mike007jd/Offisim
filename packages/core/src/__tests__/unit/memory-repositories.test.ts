import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';

describe('MemoryRepositories', () => {
  describe('ThreadRepository', () => {
    it('creates and finds a thread', async () => {
      const repos = createMemoryRepositories();
      const thread = await repos.threads.create({
        thread_id: 't-1',
        company_id: 'c-1',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });
      expect(thread.thread_id).toBe('t-1');
      expect(thread.created_at).toBeDefined();

      const found = await repos.threads.findById('t-1');
      expect(found?.status).toBe('running');
    });

    it('returns null for missing thread', async () => {
      const repos = createMemoryRepositories();
      expect(await repos.threads.findById('missing')).toBeNull();
    });

    it('updates status', async () => {
      const repos = createMemoryRepositories();
      await repos.threads.create({
        thread_id: 't-1',
        company_id: 'c-1',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });
      await repos.threads.updateStatus('t-1', 'completed');
      const found = await repos.threads.findById('t-1');
      expect(found?.status).toBe('completed');
    });
  });

  describe('TaskRunRepository', () => {
    it('creates and queries by thread', async () => {
      const repos = createMemoryRepositories();
      await repos.taskRuns.create({
        task_run_id: 'tr-1',
        thread_id: 't-1',
        employee_id: null,
        parent_task_run_id: null,
        task_type: 'boss_chat',
        status: 'running',
        input_json: null,
        output_json: null,
        started_at: new Date().toISOString(),
      });
      const runs = await repos.taskRuns.findByThread('t-1');
      expect(runs).toHaveLength(1);
    });
  });

  describe('EmployeeRepository', () => {
    it('finds by role', async () => {
      const repos = createMemoryRepositories();
      repos.seed.employees([
        {
          employee_id: 'e-1',
          company_id: 'c-1',
          source_asset_id: null,
          source_package_id: null,
          name: 'Dev Bot',
          role_slug: 'developer',
          workstation_id: null,
          persona_json: null,
          config_json: null,
          enabled: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      const devs = await repos.employees.findByRole('c-1', 'developer');
      expect(devs).toHaveLength(1);
      expect(devs[0]?.name).toBe('Dev Bot');
    });
  });

  describe('CheckpointRepository', () => {
    it('saves and finds latest', async () => {
      const repos = createMemoryRepositories();
      await repos.checkpoints.save({
        checkpoint_id: 'cp-1',
        thread_id: 't-1',
        checkpoint_seq: 1,
        checkpoint_kind: 'node_complete',
        payload_json: '{}',
        created_at: new Date().toISOString(),
      });
      await repos.checkpoints.save({
        checkpoint_id: 'cp-2',
        thread_id: 't-1',
        checkpoint_seq: 2,
        checkpoint_kind: 'interrupt',
        payload_json: '{"x":1}',
        created_at: new Date().toISOString(),
      });
      const latest = await repos.checkpoints.findLatest('t-1');
      expect(latest?.checkpoint_seq).toBe(2);
    });
  });
});
