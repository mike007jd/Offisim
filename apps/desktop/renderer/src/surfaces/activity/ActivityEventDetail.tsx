import { IconButton } from '@/design-system/grammar/IconButton.js';
import { cn } from '@/lib/utils.js';
import { X } from 'lucide-react';
import { ActivityPayloadView } from './ActivityPayloadView.js';
import {
  type ActivityRecord,
  LEVEL_BADGE_LABEL,
  formatFullTimestamp,
  getEventLevel,
} from './activity-data.js';

interface ActivityEventDetailProps {
  record: ActivityRecord;
  onClose: () => void;
}

/** The 5-section event detail panel: Event Type / Level / Timestamp / Entity /
 *  Payload. Owns its own scroll. */
export function ActivityEventDetail({ record, onClose }: ActivityEventDetailProps) {
  const level = getEventLevel(record.type);
  const typeLabel = record.type.replaceAll('.', ' / ');

  return (
    <div className="off-act-detail">
      <div className="off-ad-head">
        <h2>Event Detail</h2>
        <IconButton icon={X} label="Close detail" size="iconSm" onClick={onClose} side="left" />
      </div>
      <div className="off-ad-body">
        <section className="off-ad-sec">
          <p className="off-ad-l">Event Type</p>
          <p className="off-ad-mono">{typeLabel}</p>
        </section>

        <section className="off-ad-sec">
          <p className="off-ad-l">Level</p>
          <span className={cn('off-ad-lvl', `off-ad-lvl-${level}`)}>
            {LEVEL_BADGE_LABEL[level]}
          </span>
        </section>

        <section className="off-ad-sec">
          <p className="off-ad-l">Timestamp</p>
          <p className="off-ad-ts">{formatFullTimestamp(record.at)}</p>
        </section>

        {record.entity ? (
          <section className="off-ad-sec">
            <p className="off-ad-l">Entity</p>
            <p className="off-ad-ent">{record.entity.label}</p>
            {record.entity.type ? (
              <p className="off-ad-ent is-muted">Type: {record.entity.type}</p>
            ) : null}
            {record.entity.id ? (
              <p className="off-ad-ent is-muted is-mono">ID: {record.entity.id}</p>
            ) : null}
          </section>
        ) : null}

        <section className="off-ad-sec">
          <p className="off-ad-l">Payload</p>
          <ActivityPayloadView payload={record.payload} />
        </section>
      </div>
    </div>
  );
}
