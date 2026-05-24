import { Button } from '@offisim/ui-core';
import type { MeetingActionItem } from '../../hooks/useMeeting.js';

const PRIORITY_STYLES: Record<MeetingActionItem['priority'], string> = {
  high: 'border-danger bg-danger-surface text-danger',
  medium: 'border-warn bg-warn-surface text-warn',
  low: 'border-line bg-surface-2 text-ink-3',
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
    <section className="shrink-0 border-t border-line-soft px-2 py-2">
      <div className="rounded-r-lg border border-line bg-surface-1 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-fs-meta font-semibold uppercase tracking-wide text-ink-4">
              Meeting Action Items
            </p>
            <p className="mt-1 text-fs-meta text-ink-3">
              Delegate the follow-up work directly from chat.
            </p>
          </div>
          <span className="rounded-r-pill border border-line bg-surface-2 px-2 py-1 text-fs-meta text-ink-3">
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
                className="flex items-start gap-3 rounded-r-lg border border-line bg-surface-2 px-3 py-2.5"
              >
                <span className="pt-0.5 text-fs-sm text-ink-3" aria-hidden="true">
                  ☐
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-fs-sm leading-relaxed text-ink-1">{action.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-fs-meta text-ink-3">{employeeName}</span>
                    <span
                      className={`rounded-r-pill border px-2 py-0.5 text-fs-meta font-semibold uppercase tracking-wide ${PRIORITY_STYLES[action.priority]}`}
                    >
                      {action.priority}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onDelegate(`@${employeeName} ${action.description}`)}
                >
                  Delegate
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
