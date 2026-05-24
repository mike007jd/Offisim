import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
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
    <div className="flex flex-col gap-sp-4 pt-sp-2">
      <div className="grid grid-memory-compose items-center gap-sp-2">
        <Select
          value={draftCategory}
          onValueChange={(value) => setDraftCategory(value as (typeof MEMORY_CATEGORIES)[number])}
        >
          <SelectTrigger className="w-memory-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {MEMORY_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          value={draftContent}
          onChange={(event) => setDraftContent(event.target.value)}
          placeholder="Seed a memory..."
          className="min-w-0 flex-1 border-line bg-surface-1 text-fs-sm text-ink-1"
        />
        <Input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={draftImportance}
          onChange={(event) => setDraftImportance(Number.parseFloat(event.target.value))}
          className="w-memory-importance"
        />
        <Button
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
          variant="outline"
          className="px-3 text-fs-sm text-ink-3 disabled:cursor-not-allowed disabled:text-ink-5"
        >
          Add
        </Button>
      </div>

      <div className="grid grid-memory-filter items-center gap-sp-2">
        <Select
          value={filterCategory}
          onValueChange={(value) =>
            setFilterCategory(value as 'all' | (typeof MEMORY_CATEGORIES)[number])
          }
        >
          <SelectTrigger className="w-memory-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All categories</SelectItem>
              {MEMORY_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memories..."
          className="min-w-0 flex-1 border-line bg-surface-1 text-fs-sm text-ink-1"
        />
      </div>

      {isLoading ? (
        <p className="text-fs-sm text-ink-3">Loading memories...</p>
      ) : error ? (
        <p className="text-fs-sm text-danger">Error: {error}</p>
      ) : (
        <div className="flex flex-col gap-sp-3">
          {groupedMemories.map(({ category, entries }) => (
            <section key={category} className="rounded-r-md border border-line bg-surface-2 p-sp-3">
              <div className="mb-sp-2 flex items-center justify-between">
                <h4 className="text-fs-sm font-medium capitalize text-ink-1">{category}</h4>
                <span className="text-fs-meta text-ink-4">{entries.length}</span>
              </div>
              {entries.length === 0 ? (
                <p className="text-fs-meta text-ink-4">No entries in this category.</p>
              ) : (
                <div className="flex flex-col gap-sp-2">
                  {entries.map((memory) => (
                    <div
                      key={memory.memory_id}
                      className="rounded-r-sm border border-line bg-surface-1 p-sp-2"
                    >
                      <Textarea
                        className="min-h-20 w-full border-line bg-surface-1 text-fs-sm text-ink-1"
                        defaultValue={memory.content}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next && next !== memory.content) {
                            void updateMemory(memory.memory_id, { content: next });
                          }
                        }}
                      />
                      <div className="mt-sp-2 flex items-center gap-sp-3 text-fs-meta text-ink-3">
                        <div className="flex items-center gap-sp-2">
                          <span>Importance</span>
                          <Input
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
                            className="w-memory-importance"
                          />
                        </div>
                        <span>scope: {memory.scope}</span>
                        <span>reinforced: {memory.reinforcement_count}</span>
                        <Button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Delete this memory?')) {
                              void deleteMemory(memory.memory_id);
                            }
                          }}
                          variant="outline"
                          size="sm"
                          className="ml-auto h-7 px-2 text-fs-meta text-ink-3"
                        >
                          Delete
                        </Button>
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
