import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { Archive, ArchiveRestore, ArrowLeft, MessageSquare, SquareKanban } from 'lucide-react';
import { useMemo } from 'react';
import { useActiveConversationRuns } from '../../../assistant/runtime/conversation-run-react.js';
import {
  type BoardColumn,
  type WsBoardCard,
  useActiveProject,
  useWsBoard,
} from '../workspace-data.js';

// A2 (by design): this Kanban board is a read-only PROJECTION of conversations
// (todo/active/done columns derived from live conversation + active-run state via
// useWsBoard/useActiveConversationRuns), not a separately-persisted task board
// with its own storage. The board reflects conversation state; it is intentional,
// not an unfinished feature.
const COLUMNS: ReadonlyArray<{ key: BoardColumn; label: string; hint: string }> = [
  { key: 'todo', label: 'To do', hint: 'Open conversations' },
  { key: 'active', label: 'In progress', hint: 'Working now' },
  { key: 'waiting', label: 'Waiting on you', hint: 'Needs a decision' },
  { key: 'done', label: 'Done', hint: 'Archived' },
];

/**
 * The Kanban app — opened from the Workplace launcher, scoped to ONE project
 * (Offisim has no company-wide board; each project gets its own). Each card is a
 * conversation in that project (the unit of work); columns come from real state:
 * `archived_at` splits To do vs Done, and the single in-flight run drives the
 * live In progress / Waiting columns off the run store. Cards open the
 * conversation in Chats; the archive control files / restores it.
 */
export function KanbanApp() {
  const companyId = useUiState((s) => s.companyId);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const employees = useEmployees();

  // Per-project board, resolved through the shared selector the Workplace tile
  // also uses, so the tile and the opened board can never name a different one.
  const project = useActiveProject(companyId);
  const board = useWsBoard(project?.id ?? null);

  const activeRuns = useActiveConversationRuns();

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const cards = board.data ?? [];
  const runByThread = useMemo(
    () => new Map(activeRuns.activeRuns.map((run) => [run.threadId, run])),
    [activeRuns.activeRuns],
  );

  // Bucket each conversation into a column: `done` is durable (archived), the
  // active/waiting lanes are the live overlay for the one in-flight run. Cheap
  // enough to recompute every render, so it can never drift from the run store.
  const grouped: Record<BoardColumn, WsBoardCard[]> = {
    todo: [],
    active: [],
    waiting: [],
    done: [],
  };
  for (const card of cards) {
    let col: BoardColumn = 'todo';
    if (card.archived) col = 'done';
    else {
      const run = runByThread.get(card.threadId);
      if (run?.phase === 'awaiting-approval') col = 'waiting';
      else if (run) col = 'active';
    }
    grouped[col].push(card);
  }

  async function setArchived(threadId: string, archived: boolean) {
    const repos = await reposOrNull();
    if (!repos) return; // browser preview — no persistence
    if (archived) await repos.chatThreads.archive(threadId);
    else await repos.chatThreads.unarchive(threadId);
    await board.refetch();
  }

  // The non-board states (no project / error / empty) share one wrapper; null
  // means there is work to render the columns.
  const state = !project ? (
    <EmptyState
      icon={SquareKanban}
      title="No project yet"
      description="The board is per project. This company has no project to show a board for yet."
    />
  ) : board.isError ? (
    <ErrorState
      title="Couldn't load the board"
      detail={errorDetail(board.error, 'The work board failed to load.')}
      onRetry={() => void board.refetch()}
    />
  ) : cards.length === 0 ? (
    <EmptyState
      icon={SquareKanban}
      title="No work yet"
      description="Start a conversation with an employee in this project and it shows up here as a card."
    />
  ) : null;

  return (
    <div className="off-ws-board off-ws-detail-full">
      <div className="off-ws-board-head">
        <button
          type="button"
          className="off-ws-board-back off-focusable"
          onClick={() => setApp('workplace')}
        >
          <Icon icon={ArrowLeft} size="sm" />
          Apps
        </button>
        <span className="off-ws-list-title">Board</span>
        {project ? <span className="off-ws-board-proj">{project.name}</span> : null}
      </div>

      {state ? (
        <div className="off-ws-board-state">{state}</div>
      ) : (
        <div className="off-ws-kb-cols">
          {COLUMNS.map((col) => {
            const items = grouped[col.key];
            return (
              <section key={col.key} className={cn('off-ws-kb-col', `is-${col.key}`)}>
                <header className="off-ws-kb-col-h">
                  <span className="off-ws-kb-col-ttl">{col.label}</span>
                  <span className="off-ws-kb-col-ct">{items.length}</span>
                </header>
                <div className="off-ws-kb-col-body">
                  {items.length === 0 ? (
                    <p className="off-ws-kb-empty">{col.hint}</p>
                  ) : (
                    items.map((card) => (
                      <BoardCard
                        key={card.threadId}
                        card={card}
                        employee={card.employeeId ? (byId.get(card.employeeId) ?? null) : null}
                        onOpen={() => setApp('messenger', card.threadId)}
                        onArchiveToggle={() => void setArchived(card.threadId, !card.archived)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BoardCard({
  card,
  employee,
  onOpen,
  onArchiveToggle,
}: {
  card: WsBoardCard;
  employee: Employee | null;
  onOpen: () => void;
  onArchiveToggle: () => void;
}) {
  return (
    <div className="off-ws-kb-card">
      <button type="button" className="off-ws-kb-card-open off-focusable" onClick={onOpen}>
        <span className="off-ws-kb-card-top">
          {employee ? (
            <EmployeeAvatar
              seed={employee.id}
              appearance={employee.appearance}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={22}
              brand={employee.kind === 'external'}
            />
          ) : (
            <span className="off-ws-kb-card-team">
              <Icon icon={MessageSquare} size="sm" />
            </span>
          )}
          <span className="off-ws-kb-card-who">{employee?.name ?? 'Team'}</span>
          <span className="off-ws-kb-card-age">{card.ageLabel}</span>
        </span>
        <span className="off-ws-kb-card-ttl">{card.title}</span>
      </button>
      <button
        type="button"
        className="off-ws-kb-card-act off-focusable"
        title={card.archived ? 'Restore to To do' : 'Archive to Done'}
        aria-label={card.archived ? 'Restore conversation' : 'Archive conversation'}
        onClick={onArchiveToggle}
      >
        <Icon icon={card.archived ? ArchiveRestore : Archive} size="sm" />
      </button>
    </div>
  );
}
