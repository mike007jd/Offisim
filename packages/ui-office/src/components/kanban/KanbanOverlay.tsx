import { Button, useFocusTrap, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { X } from 'lucide-react';
import { type CSSProperties, useCallback, useRef } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { KanbanBoard } from './KanbanBoard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KanbanOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Optional user request text to show in Requirements column */
  requestText?: string;
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
export function KanbanOverlay({ open, onClose, requestText }: KanbanOverlayProps) {
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
      className="fixed inset-0 z-40 bg-slate-900/80 backdrop-blur-sm"
      style={overlayStyle}
      onClick={handleBackdropClick}
      // biome-ignore lint/a11y/useSemanticElements: <dialog> can't host this fixed full-screen overlay layout
      role="dialog"
      aria-modal="true"
      aria-label="Project board"
      aria-hidden={!open}
    >
      <div className="absolute inset-x-0 top-12 bottom-0 flex flex-col" style={panelStyle}>
        {/* Header row */}
        <div className="flex items-center justify-between px-6 py-3 shrink-0">
          <h2 className="font-black text-lg text-slate-100 uppercase tracking-wider">
            Project Board
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100"
            title="Close board (Esc)"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Board fills remaining space */}
        <div className="flex-1 overflow-hidden mx-4 mb-4 rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-xl">
          <KanbanBoard agents={agents} requestText={requestText} />
        </div>
      </div>
    </div>
  );
}
