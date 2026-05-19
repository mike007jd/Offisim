import type { MemoryEntryRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context.js';

export interface CreateEmployeeMemoryInput {
  category: MemoryEntryRow['category'];
  content: string;
  importance: number;
}

export interface UpdateEmployeeMemoryInput {
  content?: string;
  importance?: number;
}

export function useEmployeeMemories(employeeId: string, companyId: string) {
  const { repos } = useOffisimRuntimeServices();
  const [memories, setMemories] = useState<MemoryEntryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMemories = useCallback(async () => {
    if (!repos?.memories || !employeeId) {
      setMemories([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rows = await repos.memories.findByOwner(employeeId);
      setMemories(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setIsLoading(false);
    }
  }, [repos, employeeId]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const createMemory = useCallback(
    async ({ category, content, importance }: CreateEmployeeMemoryInput) => {
      if (!repos?.memories) return null;
      const created = await repos.memories.create({
        memory_id: crypto.randomUUID(),
        company_id: companyId,
        scope: 'employee',
        owner_id: employeeId,
        category,
        content,
        importance,
        confidence: 1,
      });
      setMemories((prev) => [created, ...prev]);
      return created;
    },
    [repos, companyId, employeeId],
  );

  const updateMemory = useCallback(
    async (memoryId: string, patch: UpdateEmployeeMemoryInput) => {
      if (!repos?.memories) return null;
      const updated = await repos.memories.reinforce(memoryId, patch);
      if (!updated) return null;
      setMemories((prev) =>
        prev.map((memory) => (memory.memory_id === memoryId ? updated : memory)),
      );
      return updated;
    },
    [repos],
  );

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      if (!repos?.memories) return;
      await repos.memories.delete(memoryId);
      setMemories((prev) => prev.filter((memory) => memory.memory_id !== memoryId));
    },
    [repos],
  );

  return {
    memories,
    isLoading,
    error,
    loadMemories,
    createMemory,
    updateMemory,
    deleteMemory,
  };
}
