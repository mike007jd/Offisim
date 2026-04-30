import { ChevronDown, ChevronUp, Trello } from 'lucide-react';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { CreateKanbanInput, KanbanCardData, KanbanState } from './KanbanBoard';
import { KanbanBoard } from './KanbanBoard';

export interface KanbanTrayProps {
  expanded: boolean;
  requestText?: string;
  cards?: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
  onToggle: () => void;
}

export function KanbanTray({
  expanded,
  requestText,
  cards,
  onMove,
  onCreate,
  onToggle,
}: KanbanTrayProps) {
  const agents = useAgentStates();
  const cardCount = cards?.length ?? 0;
  const hasContext = cardCount > 0 || Boolean(requestText);

  if (!expanded && !hasContext) return null;

  return (
    <section
      aria-label="Project board tray"
      className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated/92 shadow-overlay backdrop-blur-md"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-full items-center justify-between gap-3 px-4 text-left transition hover:bg-surface-hover"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Trello className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wide text-text-primary">
            Project Board
          </span>
          <span className="rounded-full border border-border-subtle bg-surface-muted px-2 py-0.5 text-[10px] text-text-muted">
            {cardCount} cards
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          {hasContext ? 'Task board' : 'No active task'}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded ? (
        <div className="h-[320px] min-h-0 border-t border-border-subtle bg-surface">
          <KanbanBoard
            agents={agents}
            requestText={requestText}
            cards={cards}
            onMove={onMove}
            onCreate={onCreate}
          />
        </div>
      ) : null}
    </section>
  );
}
