import type { MemoryEntryCreate, MemoryEntryRow, RuntimeRepositories } from '@offisim/core/browser';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyProvider } from '../../components/company/CompanyContext';
import { useEmployeeMemories } from '../../hooks/useEmployeeMemories';
import { OffisimRuntimeContext } from '../../runtime/offisim-runtime-context';

function makeMemory(partial?: Partial<MemoryEntryRow>): MemoryEntryRow {
  return {
    memory_id: 'mem-1',
    company_id: 'co-1',
    scope: 'employee',
    owner_id: 'emp-1',
    category: 'knowledge',
    content: 'Knows React',
    importance: 0.7,
    confidence: 1,
    dedupe_key: 'knows-react',
    reinforcement_count: 0,
    last_reinforced_at: new Date().toISOString(),
    metadata_json: null,
    source_thread_id: null,
    source_task_run_id: null,
    created_at: new Date().toISOString(),
    accessed_at: new Date().toISOString(),
    access_count: 0,
    ...partial,
  };
}

describe('useEmployeeMemories', () => {
  it('loads and performs CRUD operations through the memory repository', async () => {
    const entries = [makeMemory()];
    const findByOwner = vi.fn(async () => entries);
    const create = vi.fn(async (entry: MemoryEntryCreate) =>
      makeMemory({
        memory_id: entry.memory_id,
        category: entry.category,
        content: entry.content,
        importance: entry.importance,
      }),
    );
    const reinforce = vi.fn(
      async (memoryId: string, patch: { content?: string; importance?: number }) =>
        makeMemory({
          memory_id: memoryId,
          content: patch.content ?? 'Knows React',
          importance: patch.importance ?? 0.7,
        }),
    );
    const remove = vi.fn(async () => undefined);

    const repos = {
      memories: {
        findByOwner,
        create,
        reinforce,
        delete: remove,
      },
      companies: {
        findAll: vi.fn(async () => []),
      },
    } as unknown as RuntimeRepositories;

    const wrapper = ({ children }: { children: ReactNode }) => (
      <OffisimRuntimeContext.Provider
        value={{
          repos,
          eventBus: { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
          isReady: true,
          isRunning: false,
          error: null,
          sendMessage: vi.fn(),
          retryLastMessage: vi.fn(),
          clearError: vi.fn(),
          reinitRuntime: vi.fn(),
          installService: null,
          employeeVersionService: null,
          connectMcpServer: vi.fn(),
          disconnectMcpServer: vi.fn(),
          connectedMcpServers: new Set(),
          abortExecution: vi.fn(),
          unfinishedThreads: [],
          dismissUnfinishedThreads: vi.fn(),
          resumeThread: vi.fn(),
          bootstrapState: null,
        }}
      >
        <CompanyProvider repos={repos} activeCompanyId="co-1">
          {children}
        </CompanyProvider>
      </OffisimRuntimeContext.Provider>
    );

    const { result } = renderHook(() => useEmployeeMemories('emp-1', 'co-1'), { wrapper });

    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    expect(findByOwner).toHaveBeenCalledWith('emp-1');

    await act(async () => {
      await result.current.createMemory({
        category: 'decision',
        content: 'Prefers RFCs before changes',
        importance: 0.8,
      });
    });
    expect(create).toHaveBeenCalled();

    await act(async () => {
      await result.current.updateMemory('mem-1', {
        content: 'Knows React deeply',
        importance: 0.9,
      });
    });
    expect(reinforce).toHaveBeenCalledWith('mem-1', {
      content: 'Knows React deeply',
      importance: 0.9,
    });

    await act(async () => {
      await result.current.deleteMemory('mem-1');
    });
    expect(remove).toHaveBeenCalledWith('mem-1');
  });
});
