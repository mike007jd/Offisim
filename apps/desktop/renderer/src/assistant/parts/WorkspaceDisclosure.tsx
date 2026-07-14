import type { ChatMessage } from '@/data/types.js';
import { cn } from '@/lib/utils.js';
import type { WorkspaceProvenance } from '@offisim/shared-types';
import { formatWorkspaceProvenance } from '../presentation/workspace-provenance.js';

/** The ellipsized activity row keeps its exact text available on hover. */
export function RunActivitySummary({ summary }: { summary: string }) {
  return (
    <span className="off-run-act-current" title={summary}>
      {summary}
    </span>
  );
}

/**
 * Full, selectable workspace provenance for one Conversation turn.
 *
 * This deliberately does not summarize or truncate the path. The compact live
 * activity row may ellipsize, but expanding it — and every persisted message
 * after reload — must expose the exact working directory and recovery reason.
 */
export function WorkspaceDisclosure({
  provenance,
  status = 'done',
}: {
  provenance: WorkspaceProvenance;
  status?: 'running' | 'done' | 'error';
}) {
  const detail = formatWorkspaceProvenance(provenance);
  if (!detail) return null;
  return (
    <aside
      className={cn('off-work-bench', `is-${status}`, 'is-generic')}
      aria-label="Workspace used for this turn"
      data-workspace-disclosure
      title={detail}
    >
      <div className="off-work-bench-head">
        <span className="off-work-bench-family">Workspace</span>
        <span className="off-work-bench-status">Turn context</span>
      </div>
      <div className="off-work-bench-body">
        <pre
          className="off-work-bench-output"
          style={{
            maxHeight: 'none',
            overflow: 'visible',
            overflowWrap: 'anywhere',
            userSelect: 'text',
          }}
        >
          {detail}
        </pre>
      </div>
    </aside>
  );
}

/** Pure persisted-message projection, shared by MessageItem and its reload oracle. */
export function MessageWorkspaceDisclosure({
  message,
}: {
  message: Pick<ChatMessage, 'workspaceProvenance'>;
}) {
  return message.workspaceProvenance ? (
    <WorkspaceDisclosure provenance={message.workspaceProvenance} />
  ) : null;
}
