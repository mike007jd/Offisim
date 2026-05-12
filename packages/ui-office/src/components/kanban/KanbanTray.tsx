import { useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react';
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
  const cardCount = cards?.length ?? 0;
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

  return (
    <>
      <style>
        {`
          @keyframes offisim-kanban-drawer-down {
            from { opacity: 0; transform: translateY(-14px) scaleY(0.94); }
            to { opacity: 1; transform: translateY(0) scaleY(1); }
          }
          @keyframes offisim-kanban-tab-in {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
      <section
        ref={trayRef}
        aria-label="Project board tray"
        className={`${
          expanded
            ? 'fixed z-[90] h-[min(470px,58vh)] min-h-[340px] overflow-visible rounded-b-2xl rounded-t-none border border-t-0 border-border-subtle backdrop-blur-xl'
            : 'fixed left-1/2 top-[72px] z-[90] h-12 w-[190px] -translate-x-1/2 overflow-visible'
        }`}
        style={
          expanded
            ? {
                top: '72px',
                left: '56px',
                right: '56px',
                background: 'rgba(255, 255, 255, 0.985)',
                boxShadow: '0 22px 54px rgba(15, 23, 42, 0.15)',
              }
            : undefined
        }
        data-expanded={expanded ? 'true' : 'false'}
      >
        {!expanded ? (
          <button
            type="button"
            onClick={onToggle}
            className="absolute inset-0 flex items-center justify-center gap-2 rounded-b-[30px] border border-t-0 border-border-subtle bg-surface-elevated/95 px-5 text-left shadow-[0_12px_26px_rgba(15,23,42,0.10)] backdrop-blur-xl transition hover:bg-surface-hover"
            style={{ animation: 'offisim-kanban-tab-in 180ms ease-out both' }}
            aria-expanded={expanded}
            data-kanban-toggle
          >
            <Columns3 className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">Kanban</span>
            <span className="sr-only">{cardCount} cards</span>
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          </button>
        ) : null}

        {expanded ? (
          <div className="relative h-full overflow-visible rounded-b-2xl bg-surface-elevated/95">
          <KanbanBoard
            agents={agents}
            requestText={requestText}
            cards={cards}
            onMove={onMove}
            onCreate={onCreate}
            onUpdate={onUpdate}
          />
          <button
            type="button"
            aria-label="Collapse Kanban"
            className="absolute -bottom-3 left-1/2 flex h-6 w-20 -translate-x-1/2 items-center justify-center rounded-b-[22px] border border-t-0 border-border-subtle bg-surface-elevated/96 text-text-secondary shadow-[0_10px_18px_rgba(15,23,42,0.07)] transition hover:text-accent"
            onClick={onToggle}
            data-kanban-toggle
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      </section>
    </>
  );
}
