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
    zIndex: 50,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="w-[140px] rounded-lg border border-white/10 bg-slate-800/95 py-1 shadow-xl backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.action}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
            item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:bg-white/5'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
