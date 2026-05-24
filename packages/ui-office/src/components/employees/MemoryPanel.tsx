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
    <div className="memory-panel">
      <div className="memory-panel-compose">
        <Select
          value={draftCategory}
          onValueChange={(value) => setDraftCategory(value as (typeof MEMORY_CATEGORIES)[number])}
        >
          <SelectTrigger className="memory-panel-category">
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
          className="memory-panel-input"
        />
        <Input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={draftImportance}
          onChange={(event) => setDraftImportance(Number.parseFloat(event.target.value))}
          className="memory-panel-range"
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
          className="memory-panel-add"
        >
          Add
        </Button>
      </div>

      <div className="memory-panel-filter">
        <Select
          value={filterCategory}
          onValueChange={(value) =>
            setFilterCategory(value as 'all' | (typeof MEMORY_CATEGORIES)[number])
          }
        >
          <SelectTrigger className="memory-panel-category">
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
          className="memory-panel-input"
        />
      </div>

      {isLoading ? (
        <p className="memory-panel-state">Loading memories...</p>
      ) : error ? (
        <p className="memory-panel-state" data-state="error">
          Error: {error}
        </p>
      ) : (
        <div className="memory-panel-groups">
          {groupedMemories.map(({ category, entries }) => (
            <section key={category} className="memory-panel-section">
              <div className="memory-panel-section-head">
                <h4>{category}</h4>
                <span>{entries.length}</span>
              </div>
              {entries.length === 0 ? (
                <p className="memory-panel-empty">No entries in this category.</p>
              ) : (
                <div className="memory-panel-list">
                  {entries.map((memory) => (
                    <div key={memory.memory_id} className="memory-panel-card">
                      <Textarea
                        className="memory-panel-textarea"
                        defaultValue={memory.content}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next && next !== memory.content) {
                            void updateMemory(memory.memory_id, { content: next });
                          }
                        }}
                      />
                      <div className="memory-panel-card-meta">
                        <div>
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
                            className="memory-panel-range"
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
                          className="memory-panel-delete"
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
