import { Button } from '@offisim/ui-core';
import { Download, LayoutGrid, Menu, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopLibraryBarProps {
  selectedSopId: string | null;
  hasSourceUrl: boolean;
  onRun: () => void;
  onDelete: () => void;
  onSync: () => void;
  onCreateClick: () => void;
  onImportClick: () => void;
  onToggleSidebar?: () => void;
  editMode?: boolean;
  onEditModeToggle?: () => void;
  onAutoLayout?: () => void;
  allowEditMode?: boolean;
}

// ---------------------------------------------------------------------------
// SopLibraryBar — compact toolbar above the DAG canvas
// ---------------------------------------------------------------------------

export function SopLibraryBar({
  selectedSopId,
  hasSourceUrl,
  onRun,
  onDelete,
  onSync,
  onCreateClick,
  onImportClick,
  onToggleSidebar,
  editMode,
  onEditModeToggle,
  onAutoLayout,
  allowEditMode = true,
}: SopLibraryBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete();
    setConfirmDelete(false);
  }, [confirmDelete, onDelete]);

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border-default bg-surface-elevated px-3">
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleSidebar}
          aria-label="Open SOP list"
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      {/* Action buttons */}
      <Button
        variant="default"
        size="sm"
        className="gap-1 h-7 text-xs"
        onClick={onRun}
        disabled={!selectedSopId}
      >
        <Play className="w-3 h-3" /> Run
      </Button>
      <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onImportClick}>
        <Download className="w-3 h-3" /> Import
      </Button>
      <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onCreateClick}>
        <Plus className="w-3 h-3" /> Create
      </Button>

      {/* Conditional: Delete */}
      {selectedSopId && (
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 text-xs ${confirmDelete ? 'border-error text-error' : ''}`}
          onClick={handleDelete}
        >
          <Trash2 className="w-3 h-3" />
          {confirmDelete ? 'Confirm' : 'Delete'}
        </Button>
      )}

      {/* Conditional: Sync */}
      {selectedSopId && hasSourceUrl && (
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onSync}>
          <RefreshCw className="w-3 h-3" /> Sync
        </Button>
      )}

      {/* Edit mode toggle */}
      {allowEditMode && selectedSopId && onEditModeToggle && (
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 text-xs ${editMode ? 'border-warning bg-warning-muted text-warning' : ''}`}
          onClick={onEditModeToggle}
        >
          <Pencil className="w-3 h-3" />
          {editMode ? 'Editing' : 'Edit'}
        </Button>
      )}

      {/* Auto Layout (edit mode only) */}
      {allowEditMode && selectedSopId && editMode && onAutoLayout && (
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={onAutoLayout}>
          <LayoutGrid className="w-3 h-3" /> Auto Layout
        </Button>
      )}
    </div>
  );
}
