import { Button, cn } from '@offisim/ui-core';
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
    <div className="sop-toolbar">
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="sop-toolbar-icon-button"
          onClick={onToggleSidebar}
          aria-label="Open SOP list"
        >
          <Menu data-icon="toolbar-menu" />
        </Button>
      )}

      <Button
        variant="default"
        size="sm"
        className="sop-toolbar-button"
        onClick={onRun}
        disabled={!selectedSopId}
      >
        <Play data-icon="toolbar-action" /> Run
      </Button>

      {allowEditMode && selectedSopId && onEditModeToggle && (
        <Button
          variant="outline"
          size="sm"
          className={cn('sop-toolbar-button', editMode && 'sop-toolbar-button-active')}
          onClick={onEditModeToggle}
        >
          <Pencil data-icon="toolbar-action" />
          {editMode ? 'Editing' : 'Edit'}
        </Button>
      )}

      {allowEditMode && selectedSopId && editMode && onAddStep && (
        <Button variant="outline" size="sm" className="sop-toolbar-button" onClick={onAddStep}>
          <Plus data-icon="toolbar-action" /> Add Step
        </Button>
      )}

      {allowEditMode && selectedSopId && editMode && onAutoLayout && (
        <Button variant="outline" size="sm" className="sop-toolbar-button" onClick={onAutoLayout}>
          <LayoutGrid data-icon="toolbar-action" /> Auto Layout
        </Button>
      )}

      <div className="sop-toolbar-spacer" />

      {selectedSopId && hasSourceUrl && (
        <Button variant="outline" size="sm" className="sop-toolbar-button" onClick={onSync}>
          <RefreshCw data-icon="toolbar-action" /> Sync
        </Button>
      )}

      {selectedSopId && (
        <Button
          variant="outline"
          size="sm"
          className={cn('sop-toolbar-button', confirmDelete && 'sop-toolbar-button-danger')}
          onClick={handleDelete}
        >
          <Trash2 data-icon="toolbar-action" />
          {confirmDelete ? 'Confirm' : 'Delete'}
        </Button>
      )}
    </div>
  );
}
