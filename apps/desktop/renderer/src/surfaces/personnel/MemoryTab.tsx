import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
  useCreateEmployeeMemory,
  useDeleteEmployeeMemory,
  useEmployeeMemories,
  useUpdateEmployeeMemory,
} from './personnel-data.js';

const CATEGORY_OPTIONS = MEMORY_CATEGORIES.map((c) => ({ value: c, label: c }));
const FILTER_OPTIONS = [{ value: 'all', label: 'All categories' }, ...CATEGORY_OPTIONS];

interface MemoryTabProps {
  employeeId: string;
}

export function MemoryTab({ employeeId }: MemoryTabProps) {
  const query = useEmployeeMemories(employeeId);
  const createMemory = useCreateEmployeeMemory(employeeId);
  const updateMemory = useUpdateEmployeeMemory();
  const deleteMemory = useDeleteEmployeeMemory();
  const entries = query.data ?? [];

  const [composeCategory, setComposeCategory] = useState<MemoryCategory>('knowledge');
  const [composeText, setComposeText] = useState('');
  const [composeImportance, setComposeImportance] = useState(0.6);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Live importance drafts keyed by memory id, so dragging the range slider
  // feels instant without issuing a DB mutation on every pointer tick. The
  // value is committed once on pointer/key release.
  const [importanceDrafts, setImportanceDrafts] = useState<Record<string, number>>({});

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
    createMemory.mutate(
      { category: composeCategory, content, importance: composeImportance },
      {
        onSuccess: () => {
          setComposeText('');
          setComposeImportance(0.6);
          toast.success('Memory saved');
        },
        onError: (error) => {
          toast.error('Memory save failed', {
            description: error instanceof Error ? error.message : 'Could not save memory',
          });
        },
      },
    );
  };

  const updateContent = (id: string, content: string) => {
    updateMemory.mutate(
      { employeeId, memoryId: id, content },
      {
        onSuccess: () => toast.success('Memory updated'),
        onError: (error) =>
          toast.error('Memory update failed', {
            description: error instanceof Error ? error.message : 'Could not update memory',
          }),
      },
    );
  };

  const commitImportance = (id: string, persisted: number) => {
    const draft = importanceDrafts[id];
    setImportanceDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (draft === undefined || draft === persisted) return;
    updateMemory.mutate(
      { employeeId, memoryId: id, importance: draft },
      {
        onError: (error) =>
          toast.error('Memory update failed', {
            description: error instanceof Error ? error.message : 'Could not update memory',
          }),
      },
    );
  };

  const deleteEntry = (id: string) => {
    deleteMemory.mutate(
      { employeeId, memoryId: id },
      {
        onSuccess: () => toast.success('Memory deleted'),
        onError: (error) =>
          toast.error('Memory delete failed', {
            description: error instanceof Error ? error.message : 'Could not delete memory',
          }),
      },
    );
  };
  const pendingDelete = entries.find((entry) => entry.id === pendingDeleteId) ?? null;

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
            {createMemory.isPending ? 'Saving…' : 'Add'}
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
                rows.map((entry) => {
                  const importanceValue = importanceDrafts[entry.id] ?? entry.importance;
                  return (
                    <div key={entry.id} className="off-pers-mem-entry">
                      <Textarea
                        className="off-pers-memory-input"
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
                            value={importanceValue}
                            aria-label="Importance"
                            onChange={(e) =>
                              setImportanceDrafts((prev) => ({
                                ...prev,
                                [entry.id]: Number(e.target.value),
                              }))
                            }
                            onPointerUp={() => commitImportance(entry.id, entry.importance)}
                            onKeyUp={() => commitImportance(entry.id, entry.importance)}
                            onBlur={() => commitImportance(entry.id, entry.importance)}
                          />
                          <span className="off-pers-imp-val">{importanceValue.toFixed(1)}</span>
                        </label>
                        <span>scope: {entry.scope}</span>
                        <span>reinforced: {entry.reinforced}</span>
                        <button
                          type="button"
                          className="off-pers-mem-del off-focusable"
                          onClick={() => setPendingDeleteId(entry.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <DialogContent className="off-dialog-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Memory</DialogTitle>
            <DialogDescription>
              Remove this employee memory from the current working set.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete ? (
            <p className="text-[length:var(--off-fs-sm)] text-[var(--off-ink-2)]">
              {pendingDelete.content}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMemory.isPending}
              onClick={() => {
                if (pendingDelete) deleteEntry(pendingDelete.id);
                setPendingDeleteId(null);
              }}
            >
              {deleteMemory.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
