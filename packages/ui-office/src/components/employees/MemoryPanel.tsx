import { useMemo, useState } from 'react';
import { useEmployeeMemories } from '../../hooks/useEmployeeMemories.js';

const MEMORY_CATEGORIES = ['experience', 'decision', 'knowledge', 'preference'] as const;

interface MemoryPanelProps {
  employeeId: string;
  companyId: string;
}

export function MemoryPanel({ employeeId, companyId }: MemoryPanelProps) {
  const { memories, isLoading, error, createMemory, updateMemory, deleteMemory } =
    useEmployeeMemories(employeeId, companyId);
  const [draftCategory, setDraftCategory] =
    useState<(typeof MEMORY_CATEGORIES)[number]>('knowledge');
  const [draftContent, setDraftContent] = useState('');
  const [draftImportance, setDraftImportance] = useState(0.6);
  const [filterCategory, setFilterCategory] = useState<'all' | (typeof MEMORY_CATEGORIES)[number]>(
    'all',
  );
  const [search, setSearch] = useState('');

  const visibleMemories = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return memories.filter((memory) => {
      if (filterCategory !== 'all' && memory.category !== filterCategory) return false;
      if (!normalizedSearch) return true;
      return memory.content.toLowerCase().includes(normalizedSearch);
    });
  }, [memories, filterCategory, search]);

  const groupedMemories = useMemo(
    () =>
      MEMORY_CATEGORIES.map((category) => ({
        category,
        entries: visibleMemories.filter((memory) => memory.category === category),
      })),
    [visibleMemories],
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="grid grid-cols-[140px_1fr_120px_auto] gap-2">
        <select
          value={draftCategory}
          onChange={(event) =>
            setDraftCategory(event.target.value as (typeof MEMORY_CATEGORIES)[number])
          }
          className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          {MEMORY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <input
          value={draftContent}
          onChange={(event) => setDraftContent(event.target.value)}
          placeholder="Seed a memory..."
          className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={draftImportance}
          onChange={(event) => setDraftImportance(Number.parseFloat(event.target.value))}
        />
        <button
          type="button"
          disabled={!draftContent.trim()}
          onClick={async () => {
            await createMemory({
              category: draftCategory,
              content: draftContent.trim(),
              importance: draftImportance,
            });
            setDraftContent('');
          }}
          className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200"
        >
          Add
        </button>
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-2">
        <select
          value={filterCategory}
          onChange={(event) =>
            setFilterCategory(event.target.value as 'all' | (typeof MEMORY_CATEGORIES)[number])
          }
          className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          <option value="all">All categories</option>
          {MEMORY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memories..."
          className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading memories…</p>
      ) : error ? (
        <p className="text-sm text-red-400">Error: {error}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groupedMemories.map(({ category, entries }) => (
            <section key={category} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium capitalize text-slate-100">{category}</h4>
                <span className="text-xs text-slate-500">{entries.length}</span>
              </div>
              {entries.length === 0 ? (
                <p className="text-xs text-slate-500">No entries in this category.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {entries.map((memory) => (
                    <div
                      key={memory.memory_id}
                      className="rounded-md border border-white/10 bg-black/10 p-2"
                    >
                      <textarea
                        className="min-h-[72px] w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                        defaultValue={memory.content}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next && next !== memory.content) {
                            void updateMemory(memory.memory_id, { content: next });
                          }
                        }}
                      />
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                        <label className="flex items-center gap-2">
                          <span>Importance</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.1}
                            defaultValue={memory.importance}
                            onChange={(event) =>
                              void updateMemory(memory.memory_id, {
                                importance: Number.parseFloat(event.target.value),
                              })
                            }
                          />
                        </label>
                        <span>scope: {memory.scope}</span>
                        <span>reinforced: {memory.reinforcement_count}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Delete this memory?')) {
                              void deleteMemory(memory.memory_id);
                            }
                          }}
                          className="ml-auto rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
