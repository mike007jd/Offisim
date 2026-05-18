import {
  type KanbanOrigin,
  type KanbanState as SharedKanbanState,
  isKanbanTransitionAllowed,
} from '@offisim/shared-types';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '@offisim/ui-core';
import { Check, ChevronLeft, ChevronRight, ClipboardList, Pencil, X } from 'lucide-react';
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useTaskDashboard } from '../../hooks/useTaskDashboard';
import { toErrorMessage } from '../../lib/error-message.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import type { AgentState } from '../../runtime/use-agent-states';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';
import { KanbanColumn } from './KanbanColumn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KanbanBoardProps {
  /** Agent map for name resolution */
  agents?: Map<string, AgentState>;
  /** Summary text override (e.g. user's original request) */
  requestText?: string;
  cards?: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateKanbanInput) => Promise<void>;
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
  state?: KanbanState;
  origin?: KanbanOrigin;
  assignedEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
  blockedReason?: string | null;
}

export interface UpdateKanbanInput {
  title?: string;
  note?: string | null;
  assignedEmployeeId?: string | null;
  blockedReason?: string | null;
}

const KANBAN_STATES: KanbanState[] = ['todo', 'doing', 'blocked', 'review', 'done'];

const KANBAN_LABELS: Record<KanbanState, string> = {
  todo: 'Todo',
  doing: 'Doing',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
};

const ORIGIN_BADGE_CLASS: Record<KanbanOrigin, string> = {
  'pm-planner': 'border-sea-blue bg-accent-muted text-sea-blue',
  employee: 'border-kelp-green bg-success-muted text-kelp-green',
  manager: 'border-coral-orange bg-warning-muted text-coral-orange',
  human: 'border-foam bg-surface-muted text-foam',
};

const STATE_BORDER_CLASS: Record<KanbanState, string> = {
  todo: 'border-t-sea-blue',
  doing: 'border-t-coral-orange',
  blocked: 'border-t-error',
  review: 'border-t-accent',
  done: 'border-t-success',
};

const STATE_DOT_CLASS: Record<KanbanState, string> = {
  todo: 'bg-sea-blue',
  doing: 'bg-coral-orange',
  blocked: 'bg-error',
  review: 'bg-accent',
  done: 'bg-success',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanBoard({
  agents,
  requestText,
  cards,
  onMove,
  onCreate,
  onUpdate,
}: KanbanBoardProps) {
  if (cards) {
    return (
      <LiveKanbanBoard
        agents={agents}
        cards={cards}
        onMove={onMove}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />
    );
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
        <div className="h-1.5 max-w-48 flex-1 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              dashboard.isComplete ? 'bg-success' : 'bg-info',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <span className="font-mono text-caption text-text-muted tabular-nums">
          {dashboard.stats.completed}/{dashboard.stats.total} tasks
        </span>

        {dashboard.stats.active > 0 && (
          <span className="flex items-center gap-1 text-caption text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            {dashboard.stats.active} active
          </span>
        )}

        {dashboard.stats.failed > 0 && (
          <span className="text-caption text-error">{dashboard.stats.failed} failed</span>
        )}

        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            aria-label="Scroll left"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-muted hover:text-text-primary"
            onClick={() => scrollBy(-280)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            aria-label="Scroll right"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-text-muted hover:text-text-primary"
            onClick={() => scrollBy(280)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Horizontal scrolling board ── */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar">
        <div className="flex gap-3 p-3 h-full min-w-max">
          {/* ═══ Requirements column ═══ */}
          <KanbanColumn title="Requirements" stepIndex={null} status="requirements" tasks={[]}>
            <div className="space-y-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-2">
              {requestText && (
                <p className="whitespace-pre-wrap text-caption leading-relaxed text-text-primary">
                  {requestText}
                </p>
              )}
              {dashboard.summary ? (
                <p className="text-caption leading-relaxed text-text-secondary">
                  {dashboard.summary}
                </p>
              ) : requestText ? (
                <p className="text-caption italic text-text-muted">Waiting for plan…</p>
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
  agents,
  cards,
  onMove,
  onCreate,
  onUpdate,
}: {
  agents?: Map<string, AgentState>;
  cards: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateKanbanInput) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [creatingState, setCreatingState] = useState<KanbanState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const grouped = useMemo(() => groupCards(cards), [cards]);
  const assignees = useMemo(() => [...(agents?.entries() ?? [])], [agents]);

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>, state: KanbanState) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const title = String(data.get('title') ?? '');
      const note = String(data.get('note') ?? '');
      const assigneeValue = String(data.get('assignedEmployeeId') ?? '').trim();
      const assignedEmployeeId = assigneeValue && assigneeValue !== '__none' ? assigneeValue : null;
      const blockedReason = String(data.get('blockedReason') ?? '').trim() || null;
      const trimmed = title.trim();
      if (!trimmed || !onCreate) return;
      setBusyId(`new:${state}`);
      setErrorMessage(null);
      try {
        await onCreate({
          title: trimmed,
          note: note.trim() || null,
          state,
          origin: 'human',
          assignedEmployeeId,
          blockedReason,
        });
        form.reset();
        setCreatingState(null);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyId(null);
      }
    },
    [onCreate],
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

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>, state: KanbanState) => {
      event.preventDefault();
      const id = event.dataTransfer.getData('text/plain') || draggedCardId;
      const card = cards.find((item) => item.id === id);
      setDraggedCardId(null);
      if (!card || card.state === state) return;
      if (!isKanbanTransitionAllowed(card.state, state)) {
        setErrorMessage(
          `Invalid transition: ${KANBAN_LABELS[card.state]} -> ${KANBAN_LABELS[state]}`,
        );
        return;
      }
      void handleMove(card, state);
    },
    [cards, draggedCardId, handleMove],
  );

  const handleUpdate = useCallback(
    async (card: KanbanCardData, input: UpdateKanbanInput) => {
      if (!onUpdate) return;
      setBusyId(card.id);
      setErrorMessage(null);
      try {
        await onUpdate(card.id, input);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyId(null);
      }
    },
    [onUpdate],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 pb-7 pt-3">
      {errorMessage && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-error/30 bg-error-muted px-3 py-2 text-xs font-medium text-error"
        >
          {errorMessage}
        </div>
      )}

      <div className="custom-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto">
        {KANBAN_STATES.map((state) => (
          <section
            key={state}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, state)}
            className="flex min-h-0 min-w-24 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface/68 shadow-sm"
          >
            <header
              className={cn(
                'flex items-center justify-between border-b border-t-2 border-border-subtle px-3 py-3',
                STATE_BORDER_CLASS[state],
              )}
            >
              <span className="truncate text-body-sm font-bold text-text-primary">
                {KANBAN_LABELS[state]}
              </span>
              <span className="rounded-full bg-surface-muted px-1.5 font-mono text-caption text-text-muted">
                {grouped[state].length}
              </span>
            </header>
            <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              {grouped[state].map((card) => (
                <LiveKanbanCard
                  key={card.id}
                  agents={agents}
                  card={card}
                  busy={busyId === card.id}
                  onUpdate={handleUpdate}
                  onDragStart={() => setDraggedCardId(card.id)}
                  onDragEnd={() => setDraggedCardId(null)}
                />
              ))}
              {grouped[state].length === 0 && (
                <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border-subtle bg-surface/35 text-caption text-text-muted">
                  Drop here
                </div>
              )}
              {creatingState === state ? (
                <form
                  className="mt-auto space-y-2 rounded-lg border border-border-subtle bg-surface-elevated p-2.5"
                  onSubmit={(event) => handleCreate(event, state)}
                >
                  <Input
                    name="title"
                    autoFocus
                    placeholder="Card title"
                    className="h-8 border-border-subtle bg-surface px-2 text-caption"
                    disabled={!onCreate || busyId === `new:${state}`}
                  />
                  <Select
                    name="assignedEmployeeId"
                    disabled={!onCreate || busyId === `new:${state}`}
                  >
                    <SelectTrigger className="h-8 border-border-subtle bg-surface px-2 text-caption text-text-secondary">
                      <SelectValue placeholder="No assignee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No assignee</SelectItem>
                      {assignees.map(([id, agent]) => (
                        <SelectItem key={id} value={id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {state === 'blocked' ? (
                    <Input
                      name="blockedReason"
                      placeholder="Blocked reason"
                      className="h-8 border-error/25 bg-error-muted/20 px-2 text-caption text-text-secondary"
                      disabled={!onCreate || busyId === `new:${state}`}
                    />
                  ) : (
                    <Input
                      name="note"
                      placeholder="Note"
                      className="h-8 border-border-subtle bg-surface px-2 text-caption text-text-secondary"
                      disabled={!onCreate || busyId === `new:${state}`}
                    />
                  )}
                  <div className="flex gap-1">
                    <Button
                      type="submit"
                      size="sm"
                      className="h-7 flex-1 px-2 text-caption"
                      disabled={!onCreate || busyId === `new:${state}`}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-caption"
                      disabled={busyId === `new:${state}`}
                      onClick={() => setCreatingState(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-auto h-9 w-full text-body-sm text-text-secondary hover:border-border-subtle hover:text-accent"
                  disabled={!onCreate}
                  onClick={() => setCreatingState(state)}
                >
                  + Add Card
                </Button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function LiveKanbanCard({
  agents,
  card,
  busy,
  onUpdate,
  onDragStart,
  onDragEnd,
}: {
  agents?: Map<string, AgentState>;
  card: KanbanCardData;
  busy: boolean;
  onUpdate: (card: KanbanCardData, input: UpdateKanbanInput) => Promise<void>;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [note, setNote] = useState(card.note);
  const [assignee, setAssignee] = useState(card.assignedEmployeeId ?? '');
  const [blockedReason, setBlockedReason] = useState(card.blockedReason ?? '');
  const assignedAgent = card.assignedEmployeeId ? agents?.get(card.assignedEmployeeId) : null;
  const assignees = useMemo(() => [...(agents?.entries() ?? [])], [agents]);

  useEffect(() => {
    if (editing) return;
    setTitle(card.title);
    setNote(card.note);
    setAssignee(card.assignedEmployeeId ?? '');
    setBlockedReason(card.blockedReason ?? '');
  }, [card.assignedEmployeeId, card.blockedReason, card.note, card.title, editing]);

  const save = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onUpdate(card, {
      title: trimmed,
      note: note.trim() || null,
      assignedEmployeeId: assignee.trim() || null,
      blockedReason: blockedReason.trim() || null,
    });
    setEditing(false);
  }, [assignee, blockedReason, card, note, onUpdate, title]);

  return (
    <article
      className="group relative rounded-lg border border-border-subtle bg-surface-elevated p-3 shadow-sm transition hover:border-border-focus"
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-0 flex-1 border-border-subtle bg-surface px-2 py-1 text-xs font-semibold"
          />
        ) : (
          <h3 className="min-w-0 flex-1 pr-5 text-body-sm font-semibold leading-snug text-text-primary">
            {card.title}
          </h3>
        )}
        {!editing ? (
          <Button
            type="button"
            aria-label="Edit card"
            variant="outline"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6 bg-surface/85 text-text-muted opacity-0 shadow-sm hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <Badge
            variant="outline"
            size="xs"
            className={cn(
              'hidden shrink-0 px-1.5 font-bold uppercase lg:inline-flex',
              ORIGIN_BADGE_CLASS[card.origin],
            )}
          >
            {card.origin}
          </Badge>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Note"
            className="resize-none border-border-subtle bg-surface px-2 py-1 text-caption leading-relaxed text-text-secondary"
          />
          <Select
            value={assignee || '__none'}
            onValueChange={(value) => setAssignee(value === '__none' ? '' : value)}
          >
            <SelectTrigger className="h-7 border-border-subtle bg-surface px-2 text-caption text-text-secondary">
              <SelectValue placeholder="No assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No assignee</SelectItem>
              {assignees.map(([id, agent]) => (
                <SelectItem key={id} value={id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={blockedReason}
            onChange={(event) => setBlockedReason(event.target.value)}
            placeholder="Blocked reason"
            className="h-7 border-border-subtle bg-surface px-2 text-caption text-text-secondary"
          />
        </div>
      ) : (
        card.note && (
          <p className="mt-1.5 line-clamp-2 text-caption leading-relaxed text-text-secondary">
            {card.note}
          </p>
        )
      )}
      {!editing && (
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <span
              className={cn(
                'inline-flex max-w-full truncate rounded-md border px-1.5 py-0.5 text-caption font-semibold',
                card.blockedReason
                  ? 'border-error bg-error-muted text-error'
                  : ORIGIN_BADGE_CLASS[card.origin],
              )}
            >
              {card.blockedReason || originLabel(card.origin)}
            </span>
            {assignedAgent ? (
              <span className="flex min-w-0 items-center gap-1 text-caption font-medium text-text-secondary">
                <EmployeeAvatar agent={assignedAgent} size={16} className="h-4 w-4 rounded-full" />
                <span className="truncate">{assignedAgent.name}</span>
              </span>
            ) : null}
          </div>
          <span
            className={cn('mb-1 h-2 w-2 shrink-0 rounded-full', STATE_DOT_CLASS[card.state])}
            aria-label={`${KANBAN_LABELS[card.state]} status`}
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {editing ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-success/40 bg-success-muted px-2 text-caption font-semibold text-success"
              disabled={busy || title.trim().length === 0}
              onClick={() => void save()}
            >
              <Check className="h-3 w-3" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-caption text-text-secondary hover:text-text-primary"
              disabled={busy}
              onClick={() => {
                setTitle(card.title);
                setNote(card.note);
                setAssignee(card.assignedEmployeeId ?? '');
                setBlockedReason(card.blockedReason ?? '');
                setEditing(false);
              }}
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function originLabel(origin: KanbanOrigin): string {
  switch (origin) {
    case 'pm-planner':
      return 'PM Planned';
    case 'employee':
      return 'Employee';
    case 'manager':
      return 'Manager';
    case 'human':
      return 'Human';
  }
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
