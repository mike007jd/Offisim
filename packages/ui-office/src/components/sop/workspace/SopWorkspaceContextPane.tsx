import { ExternalLink, Link2 } from 'lucide-react';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import type { SopTemplate } from '../../../hooks/useSops';
import { SOP_STEP_STATUS, formatSopDateTime, pillClass } from '../../../lib/sop-utils';

export interface SopWorkspaceContextPaneProps {
  sop: SopTemplate | null;
  activeTab: 'context' | 'runs' | 'history';
  onTabChange: (tab: 'context' | 'runs' | 'history') => void;
}

function ContextTab({ sop }: { sop: SopTemplate }) {
  return (
    <div className="space-y-3">
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

      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Details</p>
        <div className="text-[11px] text-slate-400 space-y-0.5">
          <p>Steps: {sop.stepCount}</p>
          {sop.version && <p>Version: {sop.version}</p>}
          <p>Created: {formatSopDateTime(sop.createdAt)}</p>
          <p>Updated: {formatSopDateTime(sop.updatedAt)}</p>
          {sop.lastSyncedAt && <p>Last synced: {formatSopDateTime(sop.lastSyncedAt)}</p>}
        </div>
      </div>
    </div>
  );
}

function RunsTab({ sop }: { sop: SopTemplate }) {
  const runtimeState = useSopRuntimeState(sop.sopTemplateId);

  if (!runtimeState) {
    return <p className="text-[11px] text-slate-500 italic">No active runs for this SOP.</p>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
        Current Run
      </p>
      {runtimeState.map((step) => {
        const cfg = SOP_STEP_STATUS[step.status] ?? SOP_STEP_STATUS.pending;
        return (
          <div key={step.stepIndex} className="flex items-center gap-2 text-[11px] py-0.5">
            <span className="text-slate-500 font-mono w-6 text-right shrink-0">
              #{step.stepIndex + 1}
            </span>
            <span className={cfg.color}>{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function HistoryTab() {
  return (
    <p className="text-[11px] text-slate-500 italic">
      Run history will appear here once available.
    </p>
  );
}

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
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-white/5 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={pillClass(activeTab === tab.key)}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'context' && <ContextTab sop={sop} />}
        {activeTab === 'runs' && <RunsTab sop={sop} />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </div>
  );
}
