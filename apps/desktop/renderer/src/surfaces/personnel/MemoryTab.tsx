import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { useEffect, useMemo, useState } from 'react';
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryEntry,
  useEmployeeMemories,
} from './personnel-data.js';

const CATEGORY_OPTIONS = MEMORY_CATEGORIES.map((c) => ({ value: c, label: c }));
const FILTER_OPTIONS = [{ value: 'all', label: 'All categories' }, ...CATEGORY_OPTIONS];

interface MemoryTabProps {
  employeeId: string;
}

export function MemoryTab({ employeeId }: MemoryTabProps) {
  const query = useEmployeeMemories(employeeId);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  // Seed local working state from the query; re-seed when the employee changes.
  useEffect(() => {
    if (query.data) setEntries(query.data);
  }, [query.data]);

  const [composeCategory, setComposeCategory] = useState<MemoryCategory>('knowledge');
  const [composeText, setComposeText] = useState('');
  const [composeImportance, setComposeImportance] = useState(0.6);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterText, setFilterText] = useState('');

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filterCategory === 'all' || e.category === filterCategory) &&
        (!q || e.content.toLowerCase().includes(q)),
    );
  }, [entries, filterCategory, filterText]);

  const addEntry = () => {
    const content = composeText.trim();
    if (!content) return;
    setEntries((prev) => [
      {
        id: `mem-${Date.now()}`,
        category: composeCategory,
        content,
        importance: composeImportance,
        scope: 'employee',
        reinforced: 0,
      },
      ...prev,
    ]);
    setComposeText('');
    setComposeImportance(0.6);
  };

  const updateContent = (id: string, content: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, content } : e)));
  };

  const updateImportance = (id: string, importance: number) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, importance } : e)));
  };

  const deleteEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (query.isLoading) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll text-[var(--off-fs-sm)] text-[var(--off-ink-4)]">
          Loading memories…
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Compose</CapsLabel>
        <div className="off-pers-mem-compose">
          <Select
            value={composeCategory}
            onChange={(e) => setComposeCategory(e.target.value as MemoryCategory)}
            options={CATEGORY_OPTIONS}
            aria-label="Memory category"
          />
          <Input
            value={composeText}
            placeholder="Seed a memory…"
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addEntry();
            }}
          />
          <label className="off-pers-imp-row">
            <span className="off-pers-imp-val">{composeImportance.toFixed(1)}</span>
            <input
              type="range"
              className="off-pers-rng off-focusable"
              min={0}
              max={1}
              step={0.1}
              value={composeImportance}
              aria-label="Importance"
              onChange={(e) => setComposeImportance(Number(e.target.value))}
            />
          </label>
          <Button
            variant="subtle"
            size="sm"
            disabled={composeText.trim().length === 0}
            onClick={addEntry}
          >
            Add
          </Button>
        </div>

        <div className="off-pers-mem-filter">
          <Select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            options={FILTER_OPTIONS}
            aria-label="Filter by category"
          />
          <Input
            value={filterText}
            placeholder="Search memories…"
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>

        {MEMORY_CATEGORIES.map((category) => {
          const rows = filtered.filter((e) => e.category === category);
          return (
            <div key={category} className="off-pers-mem-sec">
              <div className="off-pers-mem-head">
                <h4>{category}</h4>
                <span className="off-pers-mem-count">{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <p className="off-pers-mem-empty">No entries in this category.</p>
              ) : (
                rows.map((entry) => (
                  <div key={entry.id} className="off-pers-mem-entry">
                    <Textarea
                      className="min-h-[52px] bg-[var(--off-surface-2)]"
                      defaultValue={entry.content}
                      onBlur={(e) => {
                        if (e.target.value !== entry.content)
                          updateContent(entry.id, e.target.value);
                      }}
                    />
                    <div className="off-pers-mem-row">
                      <label className="off-pers-mem-imp">
                        Importance
                        <input
                          type="range"
                          className="off-pers-rng off-focusable"
                          min={0}
                          max={1}
                          step={0.1}
                          value={entry.importance}
                          aria-label="Importance"
                          onChange={(e) => updateImportance(entry.id, Number(e.target.value))}
                        />
                        <span className="off-pers-imp-val">{entry.importance.toFixed(1)}</span>
                      </label>
                      <span>scope: {entry.scope}</span>
                      <span>reinforced: {entry.reinforced}</span>
                      <button
                        type="button"
                        className="off-pers-mem-del off-focusable"
                        onClick={() => {
                          if (window.confirm('Delete this memory?')) deleteEntry(entry.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
