import { Button, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { ChevronUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import type {
  CreateKanbanInput,
  KanbanCardData,
  KanbanState,
  UpdateKanbanInput,
} from './KanbanBoard';
import { KanbanBoard } from './KanbanBoard';

export interface KanbanTrayProps {
  expanded: boolean;
  requestText?: string;
  cards?: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateKanbanInput) => Promise<void>;
  onToggle: () => void;
}

export function KanbanTray({
  expanded,
  requestText,
  cards,
  onMove,
  onCreate,
  onUpdate,
  onToggle,
}: KanbanTrayProps) {
  const agents = useAgentStates();
  const trayRef = useRef<HTMLElement | null>(null);
  const stackId = expanded ? 'office:project-board' : null;

  useRegisterModal(stackId, 'overlay');
  useTopmostEscape(stackId, onToggle, { enabled: expanded });

  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trayRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-kanban-toggle]')) return;
      onToggle();
    }
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [expanded, onToggle]);

  if (!expanded) return null;

  return (
    <section
      ref={trayRef}
      aria-label="Project board tray"
      className="kanban-tray-expanded"
      data-expanded="true"
    >
      <div className="relative h-full overflow-visible rounded-b-2xl bg-surface-elevated/95">
        <KanbanBoard
          agents={agents}
          requestText={requestText}
          cards={cards}
          onMove={onMove}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
        <Button
          type="button"
          aria-label="Collapse Kanban"
          variant="outline"
          size="icon"
          className="absolute -bottom-3 left-1/2 flex h-6 w-20 -translate-x-1/2 items-center justify-center rounded-b-2xl border border-t-0 border-border-subtle bg-surface-elevated/96 text-text-secondary shadow-resting transition hover:text-accent"
          onClick={onToggle}
          data-kanban-toggle
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
