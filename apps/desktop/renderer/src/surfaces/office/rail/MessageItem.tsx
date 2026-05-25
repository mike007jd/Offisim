import type { ChatMessage, Employee, RunRecord } from '@/data/types.js';
import { BlockAvatar } from '@/design-system/grammar/BlockAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, initialsOf, relativeTime } from '@/lib/utils.js';
import { ChevronRight, FileText, Terminal } from 'lucide-react';
import { useState } from 'react';

function RunRecordCard({ record }: { record: RunRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('off-run-record', open && 'is-open')}>
      <button
        type="button"
        className="off-rr-head off-focusable"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={Terminal} size="sm" className="off-rr-icon" />
        <span className="off-rr-title">{record.title}</span>
        <span className="off-rr-meta">· {record.meta}</span>
        <span className="off-rr-cost">{record.costLabel}</span>
        <Icon icon={ChevronRight} size="sm" className="off-rr-caret" />
      </button>
      {open ? (
        <div className="off-rr-body">
          {record.steps.map((step) => (
            <div key={step.id} className={cn('off-rr-step', `is-${step.state}`)}>
              <span className="off-rr-step-dot" />
              <span className="off-rr-step-tool">{step.label}</span>
              <span>{step.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function authorMeta(message: ChatMessage, employeesById: Map<string, Employee>) {
  if (message.author === 'boss') return { name: 'You', employee: null };
  if (message.author === 'system') return { name: 'System', employee: null };
  const employee = message.employeeId ? employeesById.get(message.employeeId) : undefined;
  return { name: employee?.name ?? 'Employee', employee: employee ?? null };
}

interface MessageItemProps {
  message: ChatMessage;
  employeesById: Map<string, Employee>;
}

/** One message in the Office rail timeline: author, body, attachments, run record. */
export function MessageItem({ message, employeesById }: MessageItemProps) {
  const meta = authorMeta(message, employeesById);
  return (
    <article className={cn('off-msg', `is-${message.author}`)}>
      <header className="off-msg-head">
        {meta.employee ? (
          <BlockAvatar
            initials={initialsOf(meta.employee.name)}
            colorA={meta.employee.avatarA}
            colorB={meta.employee.avatarB}
            size={20}
            brand={meta.employee.kind === 'external'}
          />
        ) : null}
        <span className="off-msg-author">{meta.name}</span>
        <span className="off-msg-time">{relativeTime(message.at)}</span>
      </header>
      <div className="off-msg-body">{message.body}</div>
      {message.attachments?.map((attachment) => (
        <div key={attachment.id} className="off-attachment">
          <span className="off-att-icon">
            <Icon icon={FileText} size="sm" />
          </span>
          <span>
            <span className="off-att-name">{attachment.name}</span>
            <span className="off-att-meta">
              {attachment.ext} · {attachment.sizeLabel}
            </span>
          </span>
        </div>
      ))}
      {message.runRecord ? <RunRecordCard record={message.runRecord} /> : null}
    </article>
  );
}
