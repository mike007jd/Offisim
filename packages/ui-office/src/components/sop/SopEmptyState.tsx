import { Button } from '@offisim/ui-core';
import { ClipboardList, Download, Plus } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopEmptyStateProps {
  hasNoSops: boolean;
  onCreateClick: () => void;
  onImportClick: () => void;
}

// ---------------------------------------------------------------------------
// SopEmptyState
// ---------------------------------------------------------------------------

export function SopEmptyState({ hasNoSops, onCreateClick, onImportClick }: SopEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
        <ClipboardList className="w-7 h-7 text-slate-500" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-300">
          {hasNoSops ? 'No SOPs yet' : 'Select an SOP'}
        </p>
        <p className="text-xs text-slate-500 max-w-xs">
          {hasNoSops
            ? 'Create your first Standard Operating Procedure or import one from a URL.'
            : 'Choose an SOP from the dropdown above to view its workflow.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="gap-1" onClick={onCreateClick}>
          <Plus className="w-3.5 h-3.5" /> Create
        </Button>
        <Button variant="outline" size="sm" className="gap-1" onClick={onImportClick}>
          <Download className="w-3.5 h-3.5" /> Import
        </Button>
      </div>
    </div>
  );
}
