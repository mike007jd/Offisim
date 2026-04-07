import type { SopTemplate } from '../../../hooks/useSops';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import type { SopRuntimeStepState } from '../../../hooks/useSopRuntimeState';
import { ExternalLink, Link2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// SopWorkspaceContextPane — Task 5.4
// ---------------------------------------------------------------------------

export interface SopWorkspaceContextPaneProps {
  sop: SopTemplate | null;
  activeTab: 'context' | 'runs' | 'history';
  onTabChange: (tab: 'context' | 'runs' | 'history') => void;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Tab content: Context
// ---------------------------------------------------------------------------

function ContextTab({ sop }: { sop: SopTemplate }) {
  return (
    <div className="space-y-3">
      {/* Source info */}
      {sop.sourceUrl && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Source
          </p>
          <a
            href={sop.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 truncate"
          >
            <Link2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{sop.sourceUrl}</span>
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        </div>
      )}

      {sop.sourceThreadId && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Source Thread
          </p>
          <p className="text-[11px] text-slate-300 font-mono truncate">{sop.sourceThreadId}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Details
        </p>
        <div className="text-[11px] text-slate-400 space-y-0.5">
          <p>Steps: {sop.stepCount}</p>
          {sop.version && <p>Version: {sop.version}</p>}
          <p>Created: {formatDateTime(sop.createdAt)}</p>
          <p>Updated: {formatDateTime(sop.updatedAt)}</p>
          {sop.lastSyncedAt && <p>Last synced: {formatDateTime(sop.lastSyncedAt)}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content: Runs
// ---------------------------------------------------------------------------

function stepStatusLabel(status: SopRuntimeStepState['status']): string {
  switch (status) {
    case 'active':
      return '▶ Active';
    case 'completed':
      return '✓ Done';
    case 'failed':
      return '✗ Failed';
    default:
      return '○ Pending';
  }
}

function stepStatusColor(status: SopRuntimeStepState['status']): string {
  switch (status) {
    case 'active':
      return 'text-blue-400';
    case 'completed':
      return 'text-green-400';
    case 'failed':
      return 'text-red-400';
    default:
      return 'text-slate-500';
  }
}

function RunsTab({ sop }: { sop: SopTemplate }) {
  const runtimeState = useSopRuntimeState(sop.sopTemplateId);

  if (!runtimeState) {
    return (
      <p className="text-[11px] text-slate-500 italic">No active runs for this SOP.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
        Current Run
      </p>
      {runtimeState.map((step) => (
        <div
          key={step.stepIndex}
          className="flex items-center gap-2 text-[11px] py-0.5"
        >
          <span className="text-slate-500 font-mono w-6 text-right shrink-0">
            #{step.stepIndex + 1}
          </span>
          <span className={stepStatusColor(step.status)}>
            {stepStatusLabel(step.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab content: History (placeholder — no historical run data available yet)
// ---------------------------------------------------------------------------

function HistoryTab() {
  return (
    <p className="text-[11px] text-slate-500 italic">
      Run history will appear here once available.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const TABS: Array<{ key: 'context' | 'runs' | 'history'; label: string }> = [
  { key: 'context', label: 'Context' },
  { key: 'runs', label: 'Runs' },
  { key: 'history', label: 'History' },
];

export function SopWorkspaceContextPane({
  sop,
  activeTab,
  onTabChange,
}: SopWorkspaceContextPaneProps) {
  if (!sop) {
    return (
      <div className="p-3 text-xs text-slate-500">
        <p className="text-[10px] italic">Select an SOP to view context.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-white/5 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
              activeTab === tab.key
                ? 'bg-white/10 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'context' && <ContextTab sop={sop} />}
        {activeTab === 'runs' && <RunsTab sop={sop} />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </div>
  );
}
