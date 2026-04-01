import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { WorkspaceStalenessService } from '../../services/workspace-staleness-service.js';
import { TEST_COMPANY, TEST_COMPANY_ID } from '../helpers/fixtures.js';

describe('WorkspaceStalenessService', () => {
  it('saves a workspace snapshot baseline as a business checkpoint', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([
      {
        ...TEST_COMPANY,
        workspace_root: '/repo',
      },
    ]);

    const service = new WorkspaceStalenessService(repos, async () => ({
      workspaceRoot: '/repo',
      isGitRepository: true,
      gitHead: 'abc123',
      statusHash: 'hash-clean',
      dirty: false,
      statusLines: 0,
      capturedAt: '2026-04-01T10:00:00.000Z',
    }));

    const checkpoint = await service.saveThreadBaseline('thread-1', TEST_COMPANY_ID);

    expect(checkpoint).toEqual(
      expect.objectContaining({
        thread_id: 'thread-1',
        checkpoint_seq: 1,
        checkpoint_kind: 'workspace_snapshot',
      }),
    );
    expect(JSON.parse(checkpoint?.payload_json ?? '{}')).toEqual(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          gitHead: 'abc123',
          statusHash: 'hash-clean',
        }),
      }),
    );
  });

  it('returns clean when the current snapshot matches the saved baseline', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([
      {
        ...TEST_COMPANY,
        workspace_root: '/repo',
      },
    ]);

    const service = new WorkspaceStalenessService(repos, async () => ({
      workspaceRoot: '/repo',
      isGitRepository: true,
      gitHead: 'abc123',
      statusHash: 'hash-clean',
      dirty: false,
      statusLines: 0,
      capturedAt: '2026-04-01T10:00:00.000Z',
    }));

    await service.saveThreadBaseline('thread-1', TEST_COMPANY_ID);
    const result = await service.checkThread('thread-1', TEST_COMPANY_ID);

    expect(result.status).toBe('clean');
    expect(result.reason).toBe('baseline_matches');
  });

  it('blocks when git HEAD changes from the saved baseline', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([
      {
        ...TEST_COMPANY,
        workspace_root: '/repo',
      },
    ]);

    let currentHead = 'abc123';
    const service = new WorkspaceStalenessService(repos, async () => ({
      workspaceRoot: '/repo',
      isGitRepository: true,
      gitHead: currentHead,
      statusHash: 'hash-clean',
      dirty: false,
      statusLines: 0,
      capturedAt: '2026-04-01T10:00:00.000Z',
    }));

    await service.saveThreadBaseline('thread-1', TEST_COMPANY_ID);
    currentHead = 'def456';

    const result = await service.checkThread('thread-1', TEST_COMPANY_ID);

    expect(result.status).toBe('block');
    expect(result.reason).toBe('git_head_changed');
  });

  it('warns when the worktree changed but git HEAD stayed the same', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([
      {
        ...TEST_COMPANY,
        workspace_root: '/repo',
      },
    ]);

    let currentStatusHash = 'hash-clean';
    const service = new WorkspaceStalenessService(repos, async () => ({
      workspaceRoot: '/repo',
      isGitRepository: true,
      gitHead: 'abc123',
      statusHash: currentStatusHash,
      dirty: currentStatusHash !== 'hash-clean',
      statusLines: currentStatusHash === 'hash-clean' ? 0 : 2,
      capturedAt: '2026-04-01T10:00:00.000Z',
    }));

    await service.saveThreadBaseline('thread-1', TEST_COMPANY_ID);
    currentStatusHash = 'hash-dirty';

    const result = await service.checkThread('thread-1', TEST_COMPANY_ID);

    expect(result.status).toBe('warn');
    expect(result.reason).toBe('git_worktree_changed');
  });
});
