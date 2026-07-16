import { AssistantMessageParts } from '@/assistant/parts/AssistantMessageParts.js';
import { MessageWorkspaceDisclosure } from '@/assistant/parts/WorkspaceDisclosure.js';
import { isReasoningStreaming } from '@/assistant/parts/assistant-message-parts.js';
import type { ChatMessage, Employee, RunRecord } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, relativeTime } from '@/lib/utils.js';
import { MessagePrimitive } from '@assistant-ui/react';
import { ChevronRight, FileText, Repeat, Terminal } from 'lucide-react';
import { useState } from 'react';

/** Parse Loop reference tokens (`[[loop:<revisionId>]]`) out of a message body so
 *  the transcript can render them as Loop badges instead of raw token text. */
const TRANSCRIPT_LOOP_TOKEN_RE = /\[\[loop:([A-Za-z0-9._-]+)\]\]/g;
function loopRevisionIdsInBody(body: string): string[] {
  const ids: string[] = [];
  for (let m = TRANSCRIPT_LOOP_TOKEN_RE.exec(body); m; m = TRANSCRIPT_LOOP_TOKEN_RE.exec(body)) {
    if (m[1] && !ids.includes(m[1])) ids.push(m[1]);
  }
  TRANSCRIPT_LOOP_TOKEN_RE.lastIndex = 0;
  return ids;
}

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
  const reasoningStreaming = isReasoningStreaming(message);
  const loopRevisionIds = loopRevisionIdsInBody(message.body ?? '');
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
          <span className="off-msg-time" title={new Date(message.at).toLocaleString()}>
            {relativeTime(message.at)}
          </span>
        </header>
        <div className="off-msg-body">
          <AssistantMessageParts reasoningStreaming={reasoningStreaming} />
        </div>
        <MessageWorkspaceDisclosure message={message} />
        {loopRevisionIds.map((revisionId) => (
          <div key={revisionId} className="off-msg-loop-ref">
            <Icon icon={Repeat} size="sm" />
            <span className="off-msg-loop-ref-label">Loop run</span>
          </div>
        ))}
        {message.attachments?.map((attachment) => (
          <div key={attachment.id} className="off-attachment">
            <span className="off-att-icon">
              <Icon icon={FileText} size="sm" />
            </span>
            <span className="off-att-text">
              <span className="off-att-name">{attachment.name}</span>
              <span className="off-att-meta">
                <span className="off-fmt-tag">{attachment.ext}</span>
                {attachment.sizeLabel}
              </span>
            </span>
          </div>
        ))}
        {message.runRecord ? (
          <RunRecordCard record={message.runRecord} byId={employeesById} />
        ) : null}
      </article>
    </MessagePrimitive.Root>
  );
}
