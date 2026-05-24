import { Button } from '@offisim/ui-core';
import { LayoutGrid, Menu, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
  onAddStep?: () => void;
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
  onAddStep,
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
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-sp-5">
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-r-sm text-ink-3 hover:bg-surface-sunken hover:text-ink-1"
          onClick={onToggleSidebar}
          aria-label="Open SOP list"
        >
          <Menu className="size-4" />
        </Button>
      )}

      <Button
        variant="default"
        size="sm"
        className="h-7 gap-1 rounded-r-sm text-fs-sm"
        onClick={onRun}
        disabled={!selectedSopId}
      >
        <Play className="size-3" /> Run
      </Button>

      {allowEditMode && selectedSopId && onEditModeToggle && (
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 rounded-r-sm text-fs-sm ${editMode ? 'border-warn bg-warn-surface text-warn' : ''}`}
          onClick={onEditModeToggle}
        >
          <Pencil className="size-3" />
          {editMode ? 'Editing' : 'Edit'}
        </Button>
      )}

      {allowEditMode && selectedSopId && editMode && onAddStep && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-r-sm text-fs-sm"
          onClick={onAddStep}
        >
          <Plus className="size-3" /> Add Step
        </Button>
      )}

      {allowEditMode && selectedSopId && editMode && onAutoLayout && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-r-sm text-fs-sm"
          onClick={onAutoLayout}
        >
          <LayoutGrid className="size-3" /> Auto Layout
        </Button>
      )}

      <div className="flex-1" />

      {selectedSopId && hasSourceUrl && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-r-sm text-fs-sm"
          onClick={onSync}
        >
          <RefreshCw className="size-3" /> Sync
        </Button>
      )}

      {selectedSopId && (
        <Button
          variant="outline"
          size="sm"
          className={`h-7 gap-1 rounded-r-sm text-fs-sm ${confirmDelete ? 'border-danger text-danger' : ''}`}
          onClick={handleDelete}
        >
          <Trash2 className="size-3" />
          {confirmDelete ? 'Confirm' : 'Delete'}
        </Button>
      )}
    </div>
  );
}
