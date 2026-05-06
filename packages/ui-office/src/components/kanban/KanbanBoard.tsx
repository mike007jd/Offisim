import {
  type KanbanOrigin,
  type KanbanState as SharedKanbanState,
  isKanbanTransitionAllowed,
} from '@offisim/shared-types';
import { cn } from '@offisim/ui-core';
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { type FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { toErrorMessage } from '../../lib/error-message.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { KanbanColumn } from './KanbanColumn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanBoardProps {
  /** Agent map for name resolution */
  agents?: Map<string, { name: string }>;
  /** Summary text override (e.g. user's original request) */
  requestText?: string;
  cards?: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
}

export type KanbanState = SharedKanbanState;

export interface KanbanCardData {
  id: string;
  projectId: string;
  companyId: string;
  title: string;
  note: string;
  state: KanbanState;
  origin: KanbanOrigin;
  createdByEmployeeId: string | null;
  assignedEmployeeId: string | null;
  parentCardId: string | null;
  blockedReason: string | null;
  taskRunId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKanbanInput {
  title: string;
  note?: string | null;
  origin?: KanbanOrigin;
  assignedEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
}

const KANBAN_STATES: KanbanState[] = ['todo', 'doing', 'blocked', 'review', 'done'];

const KANBAN_LABELS: Record<KanbanState, string> = {
  todo: 'Todo',
  doing: 'Doing',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
};

const ORIGIN_COLOR: Record<KanbanOrigin, string> = {
  'pm-planner': 'var(--color-sea-blue)',
  employee: 'var(--color-kelp-green)',
  manager: 'var(--color-coral-orange)',
  human: 'var(--color-foam)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanBoard({ agents, requestText, cards, onMove, onCreate }: KanbanBoardProps) {
  if (cards) {
    return <LiveKanbanBoard cards={cards} onMove={onMove} onCreate={onCreate} />;
  }
  return <PlanKanbanBoard agents={agents} requestText={requestText} />;
}

function PlanKanbanBoard({
  agents,
  requestText,
}: Pick<KanbanBoardProps, 'agents' | 'requestText'>) {
  const dashboard = useTaskDashboard(agents);
  const { getTaskCost } = useDashboardMetrics();
  const { eventBus } = useOffisimRuntime();
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Card click → emit ui.task.focused (same pattern as TaskDashboard) ──
  const handleTaskClick = useCallback(
    (taskRunId: string) => {
      for (const step of dashboard.steps) {
        const task = step.tasks.find((t) => t.taskRunId === taskRunId);
        if (task?.employeeId) {
          eventBus.emit({
            type: 'ui.task.focused',
            entityId: task.employeeId,
            entityType: 'employee',
            companyId: '',
            timestamp: Date.now(),
            payload: { employeeId: task.employeeId, taskRunId },
          });
          break;
        }
      }
    },
    [dashboard.steps, eventBus],
  );

  // ── Scroll navigation ──
  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  if (!dashboard.planId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <ClipboardList className="h-8 w-8 text-text-muted" />
        <p className="text-sm text-text-secondary">No active plan</p>
      </div>
    );
  }

  const pct =
    dashboard.stats.total > 0
      ? Math.round((dashboard.stats.completed / dashboard.stats.total) * 100)
      : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar: plan progress summary ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle shrink-0">
        <h3 className="text-xs font-black uppercase tracking-wider text-text-secondary">Board</h3>

        {/* Progress bar */}
        <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-surface-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              dashboard.isComplete ? 'bg-success' : 'bg-info',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <span className="text-[10px] font-mono text-text-muted tabular-nums">
          {dashboard.stats.completed}/{dashboard.stats.total} tasks
        </span>

        {dashboard.stats.active > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            {dashboard.stats.active} active
          </span>
        )}

        {dashboard.stats.failed > 0 && (
          <span className="text-[10px] text-error">{dashboard.stats.failed} failed</span>
        )}

        <div className="ml-auto flex gap-1">
          <button
            type="button"
            aria-label="Scroll left"
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            onClick={() => scrollBy(-280)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            onClick={() => scrollBy(280)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Horizontal scrolling board ── */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar">
        <div className="flex gap-3 p-3 h-full min-w-max">
          {/* ═══ Requirements column ═══ */}
          <KanbanColumn title="Requirements" stepIndex={null} status="requirements" tasks={[]}>
            <div className="space-y-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-2">
              {requestText && (
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-text-primary">
                  {requestText}
                </p>
              )}
              {dashboard.summary ? (
                <p className="text-[11px] leading-relaxed text-text-secondary">
                  {dashboard.summary}
                </p>
              ) : requestText ? (
                <p className="text-[11px] italic text-text-muted">Waiting for plan…</p>
              ) : null}
            </div>
          </KanbanColumn>

          {/* ═══ Step columns ═══ */}
          {dashboard.steps.map((step) => (
            <KanbanColumn
              key={step.stepIndex}
              title={step.description}
              stepIndex={step.stepIndex}
              status={step.status}
              tasks={step.tasks}
              onTaskClick={handleTaskClick}
              getTaskCost={getTaskCost}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveKanbanBoard({
  cards,
  onMove,
  onCreate,
}: {
  cards: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const grouped = useMemo(() => groupCards(cards), [cards]);

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = title.trim();
      if (!trimmed || !onCreate) return;
      setCreating(true);
      setErrorMessage(null);
      try {
        await onCreate({ title: trimmed, note: note.trim() || null, origin: 'human' });
        setTitle('');
        setNote('');
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setCreating(false);
      }
    },
    [note, onCreate, title],
  );

  const handleMove = useCallback(
    async (card: KanbanCardData, next: KanbanState) => {
      if (!onMove || card.state === next) return;
      setBusyId(card.id);
      setErrorMessage(null);
      try {
        await onMove(card.id, next);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyId(null);
      }
    },
    [onMove],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <form
        className="flex shrink-0 items-end gap-3 border-b border-border-subtle px-4 py-3"
        onSubmit={handleCreate}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Card title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a card"
            className="h-9 w-full rounded-lg border border-border-default bg-surface-elevated px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-border-focus"
          />
        </label>
        <label className="hidden min-w-0 flex-1 md:block">
          <span className="sr-only">Card note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note"
            className="h-9 w-full rounded-lg border border-border-default bg-surface-elevated px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-border-focus"
          />
        </label>
        <button
          type="submit"
          className="h-9 shrink-0 rounded-lg border border-accent bg-accent-muted px-4 text-sm font-semibold text-accent-text transition-colors hover:bg-accent hover:text-text-inverse disabled:opacity-40"
          disabled={!onCreate || creating || title.trim().length === 0}
        >
          Add
        </button>
      </form>
      {errorMessage && (
        <div
          role="alert"
          className="border-b border-error/30 bg-error-muted px-4 py-2 text-xs font-medium text-error"
        >
          {errorMessage}
        </div>
      )}

      <div className="custom-scrollbar grid min-h-0 flex-1 grid-cols-[repeat(5,minmax(220px,1fr))] gap-3 overflow-x-auto p-4">
        {KANBAN_STATES.map((state) => (
          <section
            key={state}
            className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated"
          >
            <header className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
              <span className="text-xs font-bold text-text-primary">{KANBAN_LABELS[state]}</span>
              <span className="font-mono text-[10px] text-text-muted">{grouped[state].length}</span>
            </header>
            <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {grouped[state].map((card) => (
                <LiveKanbanCard
                  key={card.id}
                  card={card}
                  busy={busyId === card.id}
                  onMove={handleMove}
                />
              ))}
              {grouped[state].length === 0 && (
                <div className="flex flex-1 items-center justify-center text-[10px] text-text-muted">
                  No cards
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function LiveKanbanCard({
  card,
  busy,
  onMove,
}: {
  card: KanbanCardData;
  busy: boolean;
  onMove: (card: KanbanCardData, next: KanbanState) => Promise<void>;
}) {
  const allowedTargets = KANBAN_STATES.filter(
    (state) => state !== card.state && isKanbanTransitionAllowed(card.state, state),
  );

  return (
    <article className="rounded-lg border border-border-subtle bg-surface-muted p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-xs font-semibold text-text-primary">{card.title}</h3>
        <span
          className="shrink-0 rounded-full border px-1.5 text-[10px] font-bold uppercase"
          style={{ color: ORIGIN_COLOR[card.origin], borderColor: ORIGIN_COLOR[card.origin] }}
        >
          {card.origin}
        </span>
      </div>
      {card.note && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">{card.note}</p>
      )}
      {card.blockedReason && (
        <div className="mt-2 rounded-lg bg-warning-muted px-2 py-1 text-[11px] font-medium text-warning">
          ⛔ {card.blockedReason}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {allowedTargets.length > 0 ? (
          allowedTargets.map((state) => (
            <button
              key={state}
              type="button"
              className="rounded-lg border border-border-default px-2 py-1 text-[10px] text-text-secondary hover:border-border-focus hover:text-accent disabled:opacity-40"
              disabled={busy}
              onClick={() => void onMove(card, state)}
            >
              {KANBAN_LABELS[state]}
            </button>
          ))
        ) : (
          <span className="rounded-lg border border-border-default px-2 py-1 text-[10px] uppercase text-text-muted">
            Terminal
          </span>
        )}
      </div>
    </article>
  );
}

function groupCards(cards: KanbanCardData[]): Record<KanbanState, KanbanCardData[]> {
  return {
    todo: cards.filter((card) => card.state === 'todo'),
    doing: cards.filter((card) => card.state === 'doing'),
    blocked: cards.filter((card) => card.state === 'blocked'),
    review: cards.filter((card) => card.state === 'review'),
    done: cards.filter((card) => card.state === 'done'),
  };
}
