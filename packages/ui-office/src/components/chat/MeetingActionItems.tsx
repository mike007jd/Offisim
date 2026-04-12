import { Button } from '@offisim/ui-core';
import type { MeetingActionItem } from '../../hooks/useMeeting.js';

const PRIORITY_STYLES: Record<MeetingActionItem['priority'], string> = {
  high: 'border-red-400/20 bg-red-500/10 text-red-200',
  medium: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
  low: 'border-slate-400/20 bg-white/[0.05] text-slate-300',
};

export interface MeetingActionItemsProps {
  actions: MeetingActionItem[];
  agents: ReadonlyMap<string, { name: string }>;
  onDelegate: (text: string) => void;
}

export function MeetingActionItems({ actions, agents, onDelegate }: MeetingActionItemsProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="shrink-0 border-t border-white/5 px-2 py-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Meeting Action Items
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Delegate the follow-up work directly from chat.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] text-slate-400">
            {actions.length} {actions.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {actions.map((action) => {
            const employeeName =
              agents.get(action.assigneeEmployeeId)?.name ?? action.assigneeEmployeeId;

            return (
              <div
                key={action.actionItemId}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
              >
                <span className="pt-0.5 text-sm text-slate-400" aria-hidden="true">
                  ☐
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-slate-100">{action.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">{employeeName}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${PRIORITY_STYLES[action.priority]}`}
                    >
                      {action.priority}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  onClick={() => onDelegate(`@${employeeName} ${action.description}`)}
                >
                  Delegate →
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
