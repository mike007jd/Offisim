import { Button } from '@offisim/ui-core';
import { Z_INDEX_SCALE } from '@offisim/ui-core/tokens';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopNodeContextMenuProps {
  stepId: string;
  position: { x: number; y: number };
  onEdit: (stepId: string) => void;
  onDuplicate: (stepId: string) => void;
  onDelete: (stepId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Menu item data
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
}

// ---------------------------------------------------------------------------
// SopNodeContextMenu
// ---------------------------------------------------------------------------

export function SopNodeContextMenu({
  stepId,
  position,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: SopNodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside → close
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onClose]);

  // Escape → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const items: MenuItem[] = [
    {
      label: 'Edit',
      icon: <Pencil className="w-3.5 h-3.5" />,
      action: () => {
        onEdit(stepId);
        onClose();
      },
    },
    {
      label: 'Duplicate',
      icon: <Copy className="w-3.5 h-3.5" />,
      action: () => {
        onDuplicate(stepId);
        onClose();
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      action: () => {
        onDelete(stepId);
        onClose();
      },
    },
  ];

  const style: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(position.x, window.innerWidth - 160),
    top: Math.min(position.y, window.innerHeight - 140),
    zIndex: Z_INDEX_SCALE.dropdown,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="w-sop-context-menu rounded-lg border border-border-default bg-surface-elevated py-1 shadow-xl backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="ghost"
          size="sm"
          onClick={item.action}
          className={`h-auto w-full justify-start gap-2 rounded-none px-3 py-1.5 text-sm ${
            item.danger
              ? 'text-error hover:bg-error-muted'
              : 'text-text-secondary hover:bg-surface-hover'
          }`}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </div>
  );
}
