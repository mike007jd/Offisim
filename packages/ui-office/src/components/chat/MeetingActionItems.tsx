import { Button } from '@offisim/ui-core';
import type { MeetingActionItem } from '../../hooks/useMeeting.js';

const PRIORITY_STYLES: Record<MeetingActionItem['priority'], string> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
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
    <section className="meeting-actions">
      <div className="meeting-actions-panel">
        <div className="meeting-actions-head">
          <div>
            <p className="meeting-actions-title">Meeting Action Items</p>
            <p className="meeting-actions-subtitle">
              Delegate the follow-up work directly from chat.
            </p>
          </div>
          <span className="meeting-actions-count">
            {actions.length} {actions.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="meeting-actions-list">
          {actions.map((action) => {
            const employeeName =
              agents.get(action.assigneeEmployeeId)?.name ?? action.assigneeEmployeeId;

            return (
              <div key={action.actionItemId} className="meeting-action-row">
                <span className="meeting-action-check" aria-hidden="true">
                  ☐
                </span>
                <div className="meeting-action-copy">
                  <p>{action.description}</p>
                  <div>
                    <span>{employeeName}</span>
                    <span
                      className="meeting-action-priority"
                      data-priority={PRIORITY_STYLES[action.priority]}
                    >
                      {action.priority}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="meeting-action-delegate"
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
