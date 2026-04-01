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

  describe('NodeSummaryRepository', () => {
    it('creates, lists, trims, counts, and snapshots node summaries', async () => {
      const repos = createMemoryRepositories();
      for (let index = 0; index < 3; index++) {
        await repos.nodeSummaries.create({
          summary_id: `ns-${index + 1}`,
          thread_id: 't-1',
          company_id: 'c-1',
          node_name: 'boss',
          employee_id: null,
          step_index: null,
          summary_text: `Boss routed to manager (${index}).`,
          decisions_json: '["route:delegate_manager"]',
          files_touched_json: '[]',
          tools_used_json: '[]',
          input_token_count: 12,
          output_token_count: 6,
          message_count: 1,
          duration_ms: 25,
          created_at: new Date(Date.UTC(2026, 3, 1, 0, index, 0)).toISOString(),
        });
      }

      const listed = await repos.nodeSummaries.listByThread('t-1');
      expect(listed).toHaveLength(3);
      expect(listed[0]?.summary_text).toContain('Boss routed');
      await repos.nodeSummaries.trimByThread('t-1', 2);
      await expect(repos.nodeSummaries.countByThread('t-1')).resolves.toBe(2);

      const snapshot = repos.snapshot();
      const restored = createMemoryRepositories(snapshot);
      await expect(restored.nodeSummaries.listByThread('t-1')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            summary_id: 'ns-2',
            node_name: 'boss',
          }),
        ]),
      );
    });
  });

  describe('CompactSummaryRepository', () => {
    it('creates, lists, and snapshots compact summaries', async () => {
      const repos = createMemoryRepositories();
      await repos.compactSummaries.create({
        compact_id: 'cs-1',
        thread_id: 't-1',
        company_id: 'c-1',
        compact_kind: 'thread_synopsis',
        summary_source: 'llm',
        summary_text: 'Condensed thread summary.',
        pre_compact_message_count: 18,
        pre_compact_token_count: 2048,
        messages_compacted: 12,
        failure_streak: 0,
        created_at: new Date().toISOString(),
      });

      const listed = await repos.compactSummaries.listByThread('t-1');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.summary_text).toContain('Condensed');

      const restored = createMemoryRepositories(repos.snapshot());
      await expect(restored.compactSummaries.listByThread('t-1')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            compact_id: 'cs-1',
            summary_source: 'llm',
          }),
        ]),
      );
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

  describe('snapshot persistence', () => {
    it('restores company, employee, and project state from a snapshot', async () => {
      const repos = createMemoryRepositories();
      await repos.companies.create({
        company_id: 'c-1',
        name: 'Snapshot Co',
        status: 'active',
        template_id: null,
        template_label: null,
        workspace_root: null,
        default_model_policy_json: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      repos.seed.employees([
        {
          employee_id: 'e-1',
          company_id: 'c-1',
          source_asset_id: null,
          source_package_id: null,
          name: 'Persisted Agent',
          role_slug: 'developer',
          workstation_id: 'dev-desk',
          persona_json: null,
          config_json: null,
          enabled: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: 't-1',
        name: 'Persisted Project',
        description: 'snapshot roundtrip',
        status: 'active',
      });

      const snapshot = repos.snapshot();
      const restored = createMemoryRepositories(snapshot);

      await expect(restored.companies.findById('c-1')).resolves.toMatchObject({
        name: 'Snapshot Co',
      });
      await expect(restored.employees.findByCompany('c-1')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            employee_id: 'e-1',
            name: 'Persisted Agent',
            workstation_id: 'dev-desk',
          }),
        ]),
      );
      await expect(restored.projects.findByCompany('c-1')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            project_id: 'p-1',
            name: 'Persisted Project',
          }),
        ]),
      );
    });
  });
});
