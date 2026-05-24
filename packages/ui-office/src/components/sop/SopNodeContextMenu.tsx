import { Button } from '@offisim/ui-core';
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
      icon: <Pencil data-icon="context-menu" />,
      action: () => {
        onEdit(stepId);
        onClose();
      },
    },
    {
      label: 'Duplicate',
      icon: <Copy data-icon="context-menu" />,
      action: () => {
        onDuplicate(stepId);
        onClose();
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 data-icon="context-menu" />,
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
  };

  return (
    <div
      ref={menuRef}
      // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
      style={style}
      className="sop-context-menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="ghost"
          size="sm"
          onClick={item.action}
          className="sop-context-menu-item"
          data-tone={item.danger ? 'danger' : 'default'}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </div>
  );
}
