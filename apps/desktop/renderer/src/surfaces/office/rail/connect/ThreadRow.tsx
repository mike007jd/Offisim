import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, compactAge } from '@/lib/utils.js';
import type { CollaborationThreadSummary } from '@offisim/core/browser';
import { MessageSquare, Users } from 'lucide-react';

/** Shared compact age wording (lib/utils) over an ISO stamp; '' when unparsable. */
export function timeLabelFrom(iso: string): string {
  return compactAge(Date.parse(iso));
}

/* ── List row ─────────────────────────────────────────────────────────────── */

export function ThreadAvatar({
  thread,
  employee,
}: { thread: CollaborationThreadSummary; employee: Employee | null }) {
  if (thread.kind === 'group') {
    return (
      <span className="off-ws-im-av is-group">
        <Icon icon={Users} size="sm" />
      </span>
    );
  }
  if (employee) {
    return (
      <span className="off-ws-im-av-wrap">
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={40}
          brand={employee.kind === 'external'}
          className="off-ws-im-av-emp"
        />
      </span>
    );
  }
  return (
    <span className="off-ws-im-av is-group">
      <Icon icon={MessageSquare} size="sm" />
    </span>
  );
}

export function ThreadRow({
  thread,
  title,
  employee,
  active,
  onSelect,
}: {
  thread: CollaborationThreadSummary;
  title: string;
  employee: Employee | null;
  active: boolean;
  onSelect: () => void;
}) {
  const snippet = thread.lastMessage?.body?.trim() || 'No messages yet';
  return (
    <button
      type="button"
      className={cn('off-ws-im-row off-focusable', active && 'is-active')}
      onClick={onSelect}
    >
      <ThreadAvatar thread={thread} employee={employee} />
      <span className="off-ws-im-main">
        <span className="off-ws-im-l1">
          <span className="off-ws-im-name">{title}</span>
          {thread.kind === 'group' ? <span className="off-ws-im-tag">group</span> : null}
          <span className="off-ws-im-time">{timeLabelFrom(thread.lastActivityAt)}</span>
        </span>
        <span className="off-ws-im-l2">
          <span className="off-ws-im-snip">{snippet}</span>
          {thread.unreadCount > 0 ? (
            <span className="off-ws-im-nb">{thread.unreadCount}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/* ── Transcript message row ───────────────────────────────────────────────── */
