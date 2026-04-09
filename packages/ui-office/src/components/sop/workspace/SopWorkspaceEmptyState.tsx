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
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-cyan-500/[0.08] border border-cyan-400/20 flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.06)]">
        <ClipboardList className="w-7 h-7 text-cyan-400/60" />
      </div>

      {hasNoSops ? (
        <>
          <p className="text-sm text-slate-400">Create or import your first SOP</p>
          <div className="flex gap-2.5">
            <Button
              variant="outline"
              size="sm"
              className="text-[13px] gap-1.5"
              onClick={onCreateClick}
            >
              <Plus className="w-3.5 h-3.5" /> Create
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[13px] gap-1.5"
              onClick={onImportClick}
            >
              <Download className="w-3.5 h-3.5" /> Import
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">Select an SOP from the library</p>
      )}
    </div>
  );
}
