import { Button } from '@offisim/ui-core';
import type { MeetingActionItem } from '../../hooks/useMeeting.js';

const PRIORITY_STYLES: Record<MeetingActionItem['priority'], string> = {
  high: 'border-error bg-error-muted text-error',
  medium: 'border-warning bg-warning-muted text-warning',
  low: 'border-border-default bg-surface-muted text-text-secondary',
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
    <section className="shrink-0 border-t border-border-subtle px-2 py-2">
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-text-muted">
              Meeting Action Items
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Delegate the follow-up work directly from chat.
            </p>
          </div>
          <span className="rounded-full border border-border-default bg-surface-muted px-2 py-1 text-caption text-text-secondary">
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
                className="flex items-start gap-3 rounded-xl border border-border-default bg-surface-muted px-3 py-2.5"
              >
                <span className="pt-0.5 text-sm text-text-secondary" aria-hidden="true">
                  ☐
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-text-primary">{action.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-secondary">{employeeName}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-caption font-semibold uppercase tracking-[0.16em] ${PRIORITY_STYLES[action.priority]}`}
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
