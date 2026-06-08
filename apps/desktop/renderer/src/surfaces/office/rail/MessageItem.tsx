import type { ChatMessage, Employee, RunRecord } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Markdown } from '@/design-system/grammar/Markdown.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, relativeTime } from '@/lib/utils.js';
import { MessagePartPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { ChevronRight, FileText, Terminal } from 'lucide-react';
import { useState } from 'react';

/** Expanded run record: Activity (tool feed, with ×N collapse) + Plan (who did
 *  what, role + cost).
 *  Falls back to the flat step list for records that carry only steps. */
function RunRecordBody({ record, byId }: { record: RunRecord; byId: Map<string, Employee> }) {
  const hasRich = (record.activity?.length ?? 0) > 0 || (record.plan?.length ?? 0) > 0;
  if (!hasRich) {
    return (
      <div className="off-rr-body">
        {record.steps.map((step) => (
          <div key={step.id} className={cn('off-rr-step', `is-${step.state}`)}>
            <span className="off-rr-step-dot" />
            <span className="off-rr-step-tool">{step.label}</span>
            <span>{step.detail}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="off-rr-body">
      {record.activity?.length ? (
        <section className="off-rr-sec">
          <CapsLabel>Activity</CapsLabel>
          {record.activity.map((entry) => (
            <div key={entry.id} className={cn('off-rr-step', `is-${entry.state}`)}>
              <span className="off-rr-step-dot" />
              <span className="off-rr-step-tool">{entry.tool}</span>
              <span>{entry.detail}</span>
              {entry.repeat && entry.repeat > 1 ? (
                <span className="off-rr-step-x">×{entry.repeat}</span>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {record.plan?.length ? (
        <section className="off-rr-sec">
          <CapsLabel>Plan</CapsLabel>
          {record.plan.map((step) => {
            const who = step.assigneeId ? byId.get(step.assigneeId) : undefined;
            return (
              <div key={step.id} className={cn('off-rr-plan', `is-${step.state}`)}>
                <span className="off-rr-plan-seg" />
                <span className="off-rr-plan-label">{step.label}</span>
                <span className="off-rr-plan-who">
                  {who?.name ?? 'Unassigned'} · {step.roleLabel}
                </span>
                {step.costLabel ? <span className="off-rr-plan-cost">{step.costLabel}</span> : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function RunRecordCard({ record, byId }: { record: RunRecord; byId: Map<string, Employee> }) {
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
      {open ? <RunRecordBody record={record} byId={byId} /> : null}
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
    <MessagePrimitive.Root asChild>
      <article className={cn('off-msg', `is-${message.author}`)}>
      <header className="off-msg-head">
        {meta.employee ? (
          <EmployeeAvatar
            seed={meta.employee.id}
            appearance={meta.employee.appearance}
            colorA={meta.employee.avatarA}
            colorB={meta.employee.avatarB}
            size={20}
            brand={meta.employee.kind === 'external'}
          />
        ) : null}
        <span className="off-msg-author">{meta.name}</span>
        <span className="off-msg-time">{relativeTime(message.at)}</span>
      </header>
      <div className="off-msg-body">
        <MessagePrimitive.Parts>
          {({ part }) =>
            part.type === 'text' ? (
              <span className="off-msg-text">
                {/* The boss (user) message is plain text; employee/system
                    replies render Markdown so synthesized deliverables and
                    fenced code blocks read coherently instead of as raw text. */}
                {message.author === 'boss' ? (
                  <MessagePartPrimitive.Text />
                ) : (
                  <Markdown>{part.text}</Markdown>
                )}
                <MessagePartPrimitive.InProgress>
                  <span className="off-msg-cursor">|</span>
                </MessagePartPrimitive.InProgress>
              </span>
            ) : null
          }
        </MessagePrimitive.Parts>
      </div>
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
      {message.runRecord ? <RunRecordCard record={message.runRecord} byId={employeesById} /> : null}
      </article>
    </MessagePrimitive.Root>
  );
}
