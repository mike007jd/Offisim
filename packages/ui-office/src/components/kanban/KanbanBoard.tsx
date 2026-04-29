import {
  type KanbanOrigin,
  type KanbanState as SharedKanbanState,
  isKanbanTransitionAllowed,
} from '@offisim/shared-types';
import { cn } from '@offisim/ui-core';
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
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <svg
          className="h-10 w-10 text-slate-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <title>No active plan</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
          />
        </svg>
        <p className="text-sm text-slate-500">No active plan</p>
        <p className="text-xs text-slate-500">
          Send your team a task in the chat to create a project board.
        </p>
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
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Board</h3>

        {/* Progress bar */}
        <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              dashboard.isComplete ? 'bg-green-400' : 'bg-blue-400',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <span className="text-[10px] font-mono text-slate-500 tabular-nums">
          {dashboard.stats.completed}/{dashboard.stats.total} tasks
        </span>

        {dashboard.stats.active > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            {dashboard.stats.active} active
          </span>
        )}

        {dashboard.stats.failed > 0 && (
          <span className="text-[10px] text-red-400">{dashboard.stats.failed} failed</span>
        )}

        {/* Scroll arrows */}
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            aria-label="Scroll left"
            className="p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
            onClick={() => scrollBy(-280)}
            title="Scroll left"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <title>Scroll left</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            className="p-1 rounded hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
            onClick={() => scrollBy(280)}
            title="Scroll right"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <title>Scroll right</title>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Horizontal scrolling board ── */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar">
        <div className="flex gap-3 p-3 h-full min-w-max">
          {/* ═══ Requirements column ═══ */}
          <KanbanColumn title="Requirements" stepIndex={null} status="requirements" tasks={[]}>
            {/* User's original request */}
            {requestText && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-2.5 py-2 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/70">
                  User Request
                </span>
                <p className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {requestText}
                </p>
              </div>
            )}
            {/* Plan summary from PM */}
            <div className="rounded-lg border border-white/[0.06] bg-[var(--surface)] px-2.5 py-2 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {requestText ? 'Plan Summary' : 'Request'}
              </span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {dashboard.summary ||
                  (requestText ? 'Waiting for PM to create a plan...' : 'User request')}
              </p>
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
        className="flex shrink-0 items-end border-b border-white/[0.06]"
        style={{
          columnGap: 'var(--sp-md)',
          paddingInline: 'var(--sp-lg)',
          paddingBlock: 'var(--sp-md)',
        }}
        onSubmit={handleCreate}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Card title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a card"
            className="h-9 w-full border border-white/[0.08] bg-black/30 text-sm text-[color:var(--color-text-primary)] outline-none placeholder:text-slate-500 focus:border-[color:var(--color-sea-blue)]"
            style={{ borderRadius: '8px', paddingInline: 'var(--sp-md)' }}
          />
        </label>
        <label className="hidden min-w-0 flex-1 md:block">
          <span className="sr-only">Card note</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note"
            className="h-9 w-full border border-white/[0.08] bg-black/30 text-sm text-[color:var(--color-text-primary)] outline-none placeholder:text-slate-500 focus:border-[color:var(--color-sea-blue)]"
            style={{ borderRadius: '8px', paddingInline: 'var(--sp-md)' }}
          />
        </label>
        <button
          type="submit"
          className="cyber-button shrink-0"
          style={{ height: '36px', borderRadius: '8px', paddingInline: 'var(--sp-md)' }}
          disabled={!onCreate || creating || title.trim().length === 0}
        >
          Add
        </button>
      </form>
      {errorMessage && (
        <div
          role="alert"
          className="border-b border-red-500/20 bg-red-500/10 text-xs font-medium text-red-200"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-sm)' }}
        >
          {errorMessage}
        </div>
      )}

      <div
        className="grid min-h-0 flex-1 overflow-x-auto custom-scrollbar"
        style={{
          gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))',
          columnGap: 'var(--sp-md)',
          padding: 'var(--sp-lg)',
        }}
      >
        {KANBAN_STATES.map((state) => (
          <section
            key={state}
            className="flex min-h-0 flex-col overflow-hidden border border-white/[0.08]"
            style={{
              borderRadius: '8px',
              background: 'var(--color-glass-bg, var(--glass-bg))',
            }}
          >
            <header
              className="flex items-center justify-between border-b border-white/[0.06]"
              style={{ paddingInline: 'var(--sp-md)', paddingBlock: 'var(--sp-sm)' }}
            >
              <span className="text-xs font-bold text-[color:var(--color-text-primary)]">
                {KANBAN_LABELS[state]}
              </span>
              <span className="font-mono text-[10px] text-slate-500">{grouped[state].length}</span>
            </header>
            <div
              className="min-h-0 flex-1 overflow-y-auto custom-scrollbar"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--sp-sm)',
                padding: 'var(--sp-sm)',
              }}
            >
              {grouped[state].map((card) => (
                <LiveKanbanCard
                  key={card.id}
                  card={card}
                  busy={busyId === card.id}
                  onMove={handleMove}
                />
              ))}
              {grouped[state].length === 0 && (
                <div className="flex flex-1 items-center justify-center text-[10px] text-slate-500">
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
    <article className="glass-panel-sm" style={{ borderRadius: '8px', padding: 'var(--sp-md)' }}>
      <div className="flex items-start justify-between" style={{ columnGap: 'var(--sp-sm)' }}>
        <h3 className="min-w-0 flex-1 text-xs font-semibold text-[color:var(--color-text-primary)]">
          {card.title}
        </h3>
        <span
          className="shrink-0 rounded-full text-[10px] font-bold uppercase"
          style={{
            color: ORIGIN_COLOR[card.origin],
            border: `1px solid ${ORIGIN_COLOR[card.origin]}`,
            paddingInline: 'var(--sp-xs)',
          }}
        >
          {card.origin}
        </span>
      </div>
      {card.note && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{card.note}</p>}
      {card.blockedReason && (
        <div
          className="mt-2 text-[11px] font-medium"
          style={{
            color: 'var(--color-warning)',
            borderRadius: '8px',
            padding: 'var(--sp-xs) var(--sp-sm)',
            background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)',
          }}
        >
          ⛔ {card.blockedReason}
        </div>
      )}
      <div className="mt-3 flex flex-wrap" style={{ gap: 'var(--sp-xs)' }}>
        {allowedTargets.length > 0 ? (
          allowedTargets.map((state) => (
            <button
              key={state}
              type="button"
              className="border border-white/[0.08] text-[10px] text-slate-400 hover:border-[color:var(--color-sea-blue)] hover:text-[color:var(--color-sea-blue)] disabled:opacity-40"
              style={{ borderRadius: '8px', padding: 'var(--sp-xs) var(--sp-sm)' }}
              disabled={busy}
              onClick={() => void onMove(card, state)}
            >
              {KANBAN_LABELS[state]}
            </button>
          ))
        ) : (
          <span
            className="border border-white/[0.08] text-[10px] uppercase text-slate-500"
            style={{ borderRadius: '8px', padding: 'var(--sp-xs) var(--sp-sm)' }}
          >
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
