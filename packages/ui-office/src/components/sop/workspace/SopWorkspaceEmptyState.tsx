import { Button } from '@offisim/ui-core';
import { ClipboardList, Download, Plus } from 'lucide-react';

interface SopWorkspaceEmptyStateProps {
  /** True when the SOP library has zero SOPs at all */
  hasNoSops: boolean;
  onCreateClick: () => void;
  onImportClick: () => void;
}

/**
 * Empty state for the SOP workspace center pane.
 *
 * Two variants:
 * 1. No SOP selected (library has SOPs) — prompt to select one
 * 2. Empty library (no SOPs exist) — prompt to create or import
 */
export function SopWorkspaceEmptyState({
  hasNoSops,
  onCreateClick,
  onImportClick,
}: SopWorkspaceEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <ClipboardList className="w-6 h-6 text-slate-500" />
      </div>

      {hasNoSops ? (
        <>
          <div>
            <p className="text-base text-slate-300 font-medium">No SOPs yet</p>
            <p className="text-sm text-slate-500 mt-1.5 max-w-sm">
              Create your first SOP or import one from a URL to get started.
            </p>
          </div>
          <div className="flex gap-2.5 mt-2">
            <Button variant="outline" size="sm" className="text-sm gap-1.5" onClick={onCreateClick}>
              <Plus className="w-3.5 h-3.5" /> Create
            </Button>
            <Button variant="outline" size="sm" className="text-sm gap-1.5" onClick={onImportClick}>
              <Download className="w-3.5 h-3.5" /> Import
            </Button>
          </div>
        </>
      ) : (
        <div>
          <p className="text-base text-slate-400">No SOP selected</p>
          <p className="text-sm text-slate-500 mt-1.5">
            Select an SOP from the library to view its definition.
          </p>
        </div>
      )}
    </div>
  );
}
