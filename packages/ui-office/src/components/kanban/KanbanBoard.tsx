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
import { KANBAN_STATES, kanbanOriginLabel, kanbanStateLabel } from '../../lib/status-display';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
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
  const { eventBus } = useOffisimRuntimeServices();
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
      <div className="kanban-empty-plan">
        <ClipboardList data-icon="empty-plan" aria-hidden="true" />
        <p>No active plan</p>
      </div>
    );
  }

  const pct =
    dashboard.stats.total > 0
      ? Math.round((dashboard.stats.completed / dashboard.stats.total) * 100)
      : 0;
  const progressStyle = { width: `${pct}%` };

  return (
    <div className="kanban-plan-board">
      {/* ── Top bar: plan progress summary ── */}
      <div className="kanban-plan-topbar">
        <h3>Board</h3>

        {/* Progress bar */}
        <div className="kanban-progress-track">
          <div
            className="kanban-progress-bar"
            data-complete={dashboard.isComplete || undefined}
            // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
            style={progressStyle}
          />
        </div>

        <span className="kanban-progress-count">
          {dashboard.stats.completed}/{dashboard.stats.total} tasks
        </span>

        {dashboard.stats.active > 0 && (
          <span className="kanban-active-count">
            <span />
            {dashboard.stats.active} active
          </span>
        )}

        {dashboard.stats.failed > 0 && (
          <span className="kanban-failed-count">{dashboard.stats.failed} failed</span>
        )}

        <div className="kanban-scroll-actions">
          <Button
            type="button"
            aria-label="Scroll left"
            variant="ghost"
            size="icon"
            className="kanban-scroll-button"
            onClick={() => scrollBy(-280)}
          >
            <ChevronLeft data-icon="scroll-left" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            aria-label="Scroll right"
            variant="ghost"
            size="icon"
            className="kanban-scroll-button"
            onClick={() => scrollBy(280)}
          >
            <ChevronRight data-icon="scroll-right" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* ── Horizontal scrolling board ── */}
      <div ref={scrollRef} className="kanban-plan-scroll custom-scrollbar">
        <div className="kanban-plan-columns">
          {/* ═══ Requirements column ═══ */}
          <KanbanColumn title="Requirements" stepIndex={null} status="requirements" tasks={[]}>
            <div className="kanban-requirements-card">
              {requestText && <p data-primary>{requestText}</p>}
              {dashboard.summary ? (
                <p>{dashboard.summary}</p>
              ) : requestText ? (
                <p data-muted>Waiting for plan…</p>
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
          `Invalid transition: ${kanbanStateLabel(card.state)} -> ${kanbanStateLabel(state)}`,
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
    <div className="kanban-live-board">
      {errorMessage && (
        <div role="alert" className="kanban-live-error">
          {errorMessage}
        </div>
      )}

      <div className="kanban-live-scroll custom-scrollbar">
        {KANBAN_STATES.map((state) => (
          <section
            key={state}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, state)}
            className="kanban-live-column"
            data-state={state}
          >
            <header>
              <span>{kanbanStateLabel(state)}</span>
              <span>{grouped[state].length}</span>
            </header>
            <div className="kanban-live-column-body custom-scrollbar">
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
              {grouped[state].length === 0 && <div className="kanban-drop-empty">Drop here</div>}
              {creatingState === state ? (
                <form
                  className="kanban-create-form"
                  onSubmit={(event) => handleCreate(event, state)}
                >
                  <Input
                    name="title"
                    autoFocus
                    placeholder="Card title"
                    className="kanban-create-input"
                    disabled={!onCreate || busyId === `new:${state}`}
                  />
                  <Select
                    name="assignedEmployeeId"
                    disabled={!onCreate || busyId === `new:${state}`}
                  >
                    <SelectTrigger className="kanban-create-input">
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
                      className="kanban-create-input"
                      data-danger
                      disabled={!onCreate || busyId === `new:${state}`}
                    />
                  ) : (
                    <Input
                      name="note"
                      placeholder="Note"
                      className="kanban-create-input"
                      disabled={!onCreate || busyId === `new:${state}`}
                    />
                  )}
                  <div className="kanban-create-actions">
                    <Button
                      type="submit"
                      size="sm"
                      className="kanban-create-submit"
                      disabled={!onCreate || busyId === `new:${state}`}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="kanban-create-cancel"
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
                  className="kanban-add-card-button"
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
      className="kanban-live-card"
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="kanban-card-head">
        {editing ? (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="kanban-card-title-input"
          />
        ) : (
          <h3>{card.title}</h3>
        )}
        {!editing ? (
          <Button
            type="button"
            aria-label="Edit card"
            variant="outline"
            size="icon"
            className="kanban-card-edit-button"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil data-icon="edit-card" aria-hidden="true" />
          </Button>
        ) : (
          <Badge
            variant="outline"
            size="xs"
            className="kanban-origin-badge"
            data-origin={card.origin}
          >
            {kanbanOriginLabel(card.origin)}
          </Badge>
        )}
      </div>
      {editing ? (
        <div className="kanban-card-edit-stack">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Note"
            className="kanban-card-note-input"
          />
          <Select
            value={assignee || '__none'}
            onValueChange={(value) => setAssignee(value === '__none' ? '' : value)}
          >
            <SelectTrigger className="kanban-card-select">
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
            className="kanban-card-select"
          />
        </div>
      ) : (
        card.note && <p className="kanban-card-note">{card.note}</p>
      )}
      {!editing && (
        <div className="kanban-card-meta-row">
          <div className="kanban-card-meta">
            <span
              className="kanban-origin-badge"
              data-origin={card.origin}
              data-blocked={card.blockedReason ? true : undefined}
            >
              {card.blockedReason || kanbanOriginLabel(card.origin)}
            </span>
            {assignedAgent ? (
              <span className="kanban-card-assignee">
                <EmployeeAvatar
                  agent={assignedAgent}
                  size={16}
                  className="kanban-card-assignee-avatar"
                />
                <span>{assignedAgent.name}</span>
              </span>
            ) : null}
          </div>
          <span
            className="kanban-state-dot"
            data-state={card.state}
            aria-label={`${kanbanStateLabel(card.state)} status`}
          />
        </div>
      )}
      <div className="kanban-card-actions">
        {editing ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="kanban-card-save"
              disabled={busy || title.trim().length === 0}
              onClick={() => void save()}
            >
              <Check data-icon="save-card" aria-hidden="true" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="kanban-card-cancel"
              disabled={busy}
              onClick={() => {
                setTitle(card.title);
                setNote(card.note);
                setAssignee(card.assignedEmployeeId ?? '');
                setBlockedReason(card.blockedReason ?? '');
                setEditing(false);
              }}
            >
              <X data-icon="cancel-card" aria-hidden="true" />
              Cancel
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function groupCards(cards: KanbanCardData[]): Record<KanbanState, KanbanCardData[]> {
  const grouped = {} as Record<KanbanState, KanbanCardData[]>;
  for (const state of KANBAN_STATES) grouped[state] = [];
  for (const card of cards) grouped[card.state].push(card);
  return grouped;
}
