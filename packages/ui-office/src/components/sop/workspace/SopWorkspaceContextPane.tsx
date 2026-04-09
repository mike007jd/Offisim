import { ExternalLink, Link2 } from 'lucide-react';
import { useMemo } from 'react';
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
    <div className="space-y-4">
      {sop.sourceUrl && (
        <a
          href={sop.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-[12px] text-cyan-400 hover:text-cyan-300 hover:border-cyan-400/20 transition-colors truncate"
        >
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="truncate flex-1">{sop.sourceUrl}</span>
          <ExternalLink className="w-3 h-3 shrink-0 text-slate-600" />
        </a>
      )}

      {sop.sourceThreadId && (
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <p className="text-[11px] text-slate-600 mb-1">Thread</p>
          <p className="text-[12px] text-slate-300 font-mono truncate">{sop.sourceThreadId}</p>
        </div>
      )}

      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <div>
            <p className="text-slate-600">Steps</p>
            <p className="text-slate-300">{sop.stepCount}</p>
          </div>
          {sop.version && (
            <div>
              <p className="text-slate-600">Version</p>
              <p className="text-slate-300">{sop.version}</p>
            </div>
          )}
          <div>
            <p className="text-slate-600">Created</p>
            <p className="text-slate-300">{formatSopDateTime(sop.createdAt)}</p>
          </div>
          <div>
            <p className="text-slate-600">Updated</p>
            <p className="text-slate-300">{formatSopDateTime(sop.updatedAt)}</p>
          </div>
          {sop.lastSyncedAt && (
            <div className="col-span-2">
              <p className="text-slate-600">Last synced</p>
              <p className="text-slate-300">{formatSopDateTime(sop.lastSyncedAt)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RunsTab({ sop }: { sop: SopTemplate }) {
  const runtimeState = useSopRuntimeState(sop.sopTemplateId);

  const progress = useMemo(() => {
    if (!runtimeState || runtimeState.length === 0) return 0;
    const done = runtimeState.filter((s) => s.status === 'completed').length;
    return Math.round((done / runtimeState.length) * 100);
  }, [runtimeState]);

  if (!runtimeState) {
    return <p className="text-[13px] text-slate-600 italic">No active runs for this SOP.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Progress</span>
          <span className="text-slate-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        {runtimeState.map((step) => {
          const cfg = SOP_STEP_STATUS[step.status] ?? SOP_STEP_STATUS.pending;
          const dotColor =
            step.status === 'completed'
              ? 'bg-emerald-400'
              : step.status === 'active'
                ? 'bg-cyan-400 animate-pulse'
                : step.status === 'failed'
                  ? 'bg-red-400'
                  : 'bg-slate-700';
          return (
            <div
              key={step.stepIndex}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/[0.03] transition-colors"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
              <span className="text-[12px] text-slate-300 flex-1 truncate">
                Step {step.stepIndex + 1}
              </span>
              <span
                className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                  step.status === 'completed'
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : step.status === 'active'
                      ? 'text-cyan-300 bg-cyan-500/10'
                      : step.status === 'failed'
                        ? 'text-red-400 bg-red-500/10'
                        : `${cfg.color}`
                }`}
              >
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTab() {
  return (
    <p className="text-[13px] text-slate-600 italic">
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
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center h-full">
        <p className="text-[13px] text-slate-600">Select an SOP to view context.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-4 pt-3 pb-2.5 border-b border-white/[0.06] shrink-0">
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

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'context' && <ContextTab sop={sop} />}
        {activeTab === 'runs' && <RunsTab sop={sop} />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </div>
  );
}
