import { Button, useFocusTrap, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { X } from 'lucide-react';
import { type CSSProperties, useCallback, useRef } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { CreateKanbanInput, KanbanCardData, KanbanState } from './KanbanBoard';
import { KanbanBoard } from './KanbanBoard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KanbanOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Optional user request text to show in Requirements column */
  requestText?: string;
  cards?: KanbanCardData[];
  onMove?: (id: string, next: KanbanState) => Promise<void>;
  onCreate?: (input: CreateKanbanInput) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Full-screen overlay Kanban board.
 *
 * Same pattern as DashboardOverlay — covers the scene area,
 * header stays visible, Escape closes.
 */
export function KanbanOverlay({
  open,
  onClose,
  requestText,
  cards,
  onMove,
  onCreate,
}: KanbanOverlayProps) {
  const agents = useAgentStates();
  const overlayRef = useRef<HTMLDivElement>(null);

  const kanbanStackId = 'kanban-overlay';
  useRegisterModal(open ? kanbanStackId : null, 'overlay');
  useTopmostEscape(open ? kanbanStackId : null, onClose, { enabled: open });
  useFocusTrap(overlayRef, open);

  // Close when clicking backdrop
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  const overlayStyle: CSSProperties = {
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    transition: 'opacity 200ms ease-in-out',
  };

  const panelStyle: CSSProperties = {
    transform: open ? 'translateY(0)' : 'translateY(12px)',
    transition: 'transform 200ms ease-in-out',
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by useTopmostEscape; backdrop click is a mouse affordance only
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
      style={overlayStyle}
      onClick={handleBackdropClick}
      // biome-ignore lint/a11y/useSemanticElements: <dialog> can't host this fixed full-screen overlay layout
      role="dialog"
      aria-modal="true"
      aria-label="Project board"
      aria-hidden={!open}
    >
      <div
        className="absolute inset-x-0 top-12 flex flex-col"
        style={{ ...panelStyle, height: '65%' }}
      >
        <div
          className="glass-panel relative flex h-full flex-col overflow-hidden rounded-t-none"
          style={{
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: '8px',
            borderBottomRightRadius: '8px',
            marginInline: 'var(--sp-lg)',
          }}
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{
              background:
                'linear-gradient(90deg, var(--color-sea-blue), var(--color-kelp-green), var(--color-sea-blue))',
              boxShadow: '0 0 18px color-mix(in srgb, var(--color-sea-blue) 55%, transparent)',
            }}
          />
          <div
            className="flex shrink-0 items-center justify-between border-b border-white/[0.06]"
            style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
          >
            <h2 className="text-sm font-black uppercase text-[color:var(--color-text-primary)]">
              Project Board
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="cyber-button inline-flex items-center"
              style={{ padding: 'var(--sp-xs) var(--sp-sm)', borderRadius: '8px' }}
              title="Close board (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <KanbanBoard
              agents={agents}
              requestText={requestText}
              cards={cards}
              onMove={onMove}
              onCreate={onCreate}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
