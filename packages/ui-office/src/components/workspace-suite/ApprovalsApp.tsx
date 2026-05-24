import type { InteractionKind } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Check, MessageSquare } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useOffisimRuntimeInteraction } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { InteractionDecisionCard } from '../chat/InteractionDecisionCard';
import { SkillInstallConfirmBubble } from '../chat/SkillInstallConfirmBubble';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';
import type { ApprovalsInbox, PendingApproval, ResolvedApproval } from './useApprovalsInbox';

export interface ApprovalsAppProps {
  inbox: ApprovalsInbox;
  filter: 'todo' | 'done';
  onFilterChange: (filter: 'todo' | 'done') => void;
  selectedHistoryId: string | null;
  onSelectHistory: (historyId: string | null) => void;
  /** Office active thread — when a pending approval is for this thread it is the
   * live in-memory pending interaction and resolvable in place. */
  activeThreadId: string | null;
  /** Clamp Office `selectedThreadId` to a thread to surface its live gate. */
  onOpenThread: (threadId: string) => void;
}

const KIND_META: Record<InteractionKind, { label: string; tone: string }> = {
  permission_request: { label: 'Permission', tone: 'warning' },
  plan_review: { label: 'Plan review', tone: 'accent' },
  agent_question: { label: 'Question', tone: 'violet' },
  skill_install_confirm: { label: 'Install', tone: 'success' },
};

const KIND_ORDER: readonly InteractionKind[] = [
  'permission_request',
  'plan_review',
  'agent_question',
  'skill_install_confirm',
];

export function ApprovalsApp(props: ApprovalsAppProps) {
  const {
    inbox,
    filter,
    onFilterChange,
    selectedHistoryId,
    onSelectHistory,
    activeThreadId,
    onOpenThread,
  } = props;
  const { pendingInteraction, respondToInteraction } = useOffisimRuntimeInteraction();
  const agents = useAgentStates();

  // Suite-local selection of a pending entry (To-do view). Resolved selection is
  // session-state (`selectedHistoryId`) so Escape can drill back.
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);

  const employeeName = useCallback(
    (employeeId?: string | null) => (employeeId ? (agents.get(employeeId)?.name ?? null) : null),
    [agents],
  );

  // Pending entries ordered by kind (KIND_ORDER), preserving inbox order within
  // each kind bucket.
  const orderedPending = useMemo(
    () => KIND_ORDER.flatMap((kind) => inbox.pending.filter((item) => item.kind === kind)),
    [inbox.pending],
  );

  const selectedPending = useMemo(
    () => inbox.pending.find((p) => p.interactionId === selectedPendingId) ?? null,
    [inbox.pending, selectedPendingId],
  );
  const selectedResolved = useMemo(
    () => inbox.resolved.find((r) => r.historyId === selectedHistoryId) ?? null,
    [inbox.resolved, selectedHistoryId],
  );

  const handleSelectPending = (item: PendingApproval) => {
    onSelectHistory(null);
    setSelectedPendingId(item.interactionId);
  };
  const handleSelectResolved = (item: ResolvedApproval) => {
    setSelectedPendingId(null);
    onSelectHistory(item.historyId);
  };

  return (
    <div className="approvals-app">
      {/* List */}
      <div className="approvals-list">
        <div className="approvals-list-head">
          <span>Approvals</span>
          <div className="approvals-filter-tabs">
            <FilterTab
              active={filter === 'todo'}
              label="To do"
              count={inbox.pending.length}
              onClick={() => onFilterChange('todo')}
            />
            <FilterTab
              active={filter === 'done'}
              label="Done"
              onClick={() => onFilterChange('done')}
            />
          </div>
        </div>

        <div className="approvals-list-scroll">
          {filter === 'todo' ? (
            orderedPending.length === 0 ? (
              <p className="approvals-list-empty">Nothing waiting — no pending approvals.</p>
            ) : (
              orderedPending.map((item) => (
                <PendingRow
                  key={item.interactionId}
                  item={item}
                  active={item.interactionId === selectedPendingId}
                  employeeName={employeeName(item.request.employeeId)}
                  employeeId={item.request.employeeId ?? null}
                  onClick={() => handleSelectPending(item)}
                />
              ))
            )
          ) : inbox.resolved.length === 0 ? (
            <p className="approvals-list-empty">No resolved approvals yet.</p>
          ) : (
            inbox.resolved.map((item) => (
              <ResolvedRow
                key={item.historyId}
                item={item}
                active={item.historyId === selectedHistoryId}
                onClick={() => handleSelectResolved(item)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="approvals-detail">
        {filter === 'todo' && selectedPending ? (
          <PendingDetail
            item={selectedPending}
            employeeName={employeeName(selectedPending.request.employeeId)}
            isLive={
              pendingInteraction?.interactionId === selectedPending.interactionId &&
              selectedPending.threadId === pendingInteraction?.threadId
            }
            canResolve={Boolean(respondToInteraction)}
            onRespond={respondToInteraction}
            onOpenThread={() => onOpenThread(selectedPending.threadId)}
            isActiveThread={selectedPending.threadId === activeThreadId}
          />
        ) : filter === 'done' && selectedResolved ? (
          <ResolvedDetail
            item={selectedResolved}
            employeeName={employeeName(selectedResolved.request.employeeId)}
          />
        ) : (
          <div className="approvals-detail-empty">Select an approval to review it.</div>
        )}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="approvals-filter-tab"
      data-active={active || undefined}
    >
      {label}
      {count != null && count > 0 ? <span>{count}</span> : null}
    </Button>
  );
}

function KindBadge({ kind }: { kind: InteractionKind }) {
  const meta = KIND_META[kind];
  return (
    <span className="approvals-kind-wrap">
      <span className="approvals-kind-badge" data-tone={meta.tone}>
        {meta.label}
      </span>
    </span>
  );
}

function PendingRow({
  item,
  active,
  employeeName,
  employeeId,
  onClick,
}: {
  item: PendingApproval;
  active: boolean;
  employeeName: string | null;
  employeeId: string | null;
  onClick: () => void;
}) {
  const agents = useAgentStates();
  const agent = employeeId ? agents.get(employeeId) : null;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="approvals-row"
      data-active={active || undefined}
    >
      <KindBadge kind={item.kind} />
      <span className="approvals-row-title">{item.request.title}</span>
      <span className="approvals-row-meta">
        {agent ? (
          <span className="approvals-row-avatar">
            <EmployeeAvatar agent={agent} size={16} />
          </span>
        ) : null}
        {employeeName ? `${employeeName}${agent ? ` · ${agent.role}` : ''}` : 'System'}
      </span>
    </Button>
  );
}

function ResolvedRow({
  item,
  active,
  onClick,
}: {
  item: ResolvedApproval;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="approvals-row"
      data-active={active || undefined}
    >
      <KindBadge kind={item.kind} />
      <span className="approvals-row-title">{item.request.title}</span>
      <span className="approvals-row-meta">
        <Check data-icon="resolved" aria-hidden="true" />
        {item.status === 'resolved'
          ? `Resolved · ${item.selectedOptionId ?? 'answered'}`
          : item.status}
      </span>
    </Button>
  );
}

function DetailHead({
  kind,
  title,
  employeeName,
}: {
  kind: InteractionKind;
  title: string;
  employeeName: string | null;
}) {
  const meta = KIND_META[kind];
  return (
    <div className="approvals-detail-head">
      <span className="approvals-kind-badge" data-tone={meta.tone}>
        {meta.label}
      </span>
      <div className="approvals-detail-title">{title}</div>
      {employeeName ? <div className="approvals-detail-source">From {employeeName}</div> : null}
    </div>
  );
}

function DetailCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="approvals-detail-card">
      <div>{label}</div>
      {children}
    </div>
  );
}

function PendingDetail({
  item,
  employeeName,
  isLive,
  canResolve,
  onRespond,
  onOpenThread,
  isActiveThread,
}: {
  item: PendingApproval;
  employeeName: string | null;
  isLive: boolean;
  canResolve: boolean;
  onRespond?: (selectedOptionId: string, freeformResponse?: string) => Promise<unknown>;
  onOpenThread: () => void;
  isActiveThread: boolean;
}) {
  const handleRespond = useCallback(
    async (selectedOptionId: string, freeformResponse?: string) => {
      if (!onRespond) return;
      await onRespond(selectedOptionId, freeformResponse);
    },
    [onRespond],
  );

  const actionable = isLive && canResolve;

  return (
    <div className="approvals-detail-shell">
      <DetailHead kind={item.kind} title={item.request.title} employeeName={employeeName} />
      <div className="approvals-detail-scroll">
        {actionable ? (
          item.kind === 'skill_install_confirm' &&
          item.request.context?.type === 'skill_install_confirm' ? (
            <SkillInstallConfirmBubble
              request={item.request}
              context={item.request.context}
              employeeName={employeeName}
              onRespond={(id) => void handleRespond(id)}
            />
          ) : (
            <InteractionDecisionCard
              request={item.request}
              employeeName={employeeName}
              onRespond={handleRespond}
            />
          )
        ) : (
          <div className="approvals-detail-stack">
            <DetailCard label="Request">
              <p className="approvals-detail-copy">{item.request.prompt}</p>
            </DetailCard>
            <div className="approvals-thread-callout">
              <p>
                This gate is waiting in another conversation. Open its thread to review and resolve
                it inline — resolving routes through the standard interaction path.
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={onOpenThread}
                className="approvals-thread-button"
              >
                <MessageSquare data-icon="thread" aria-hidden="true" />
                {isActiveThread ? 'Open conversation' : 'Open in chat'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolvedDetail({
  item,
  employeeName,
}: {
  item: ResolvedApproval;
  employeeName: string | null;
}) {
  return (
    <div className="approvals-detail-shell">
      <DetailHead kind={item.kind} title={item.request.title} employeeName={employeeName} />
      <div className="approvals-detail-scroll">
        <div className="approvals-detail-stack">
          <DetailCard label="Request">
            <p className="approvals-detail-copy">{item.request.prompt}</p>
          </DetailCard>
          <DetailCard label="Resolution">
            <dl className="approvals-resolution-list">
              <div>
                <dt>Status</dt>
                <dd data-transform="capitalize">{item.status}</dd>
              </div>
              {item.selectedOptionId ? (
                <div>
                  <dt>Decision</dt>
                  <dd>{item.selectedOptionId}</dd>
                </div>
              ) : null}
              {item.freeformResponse ? (
                <div>
                  <dt>Note</dt>
                  <dd data-wrap="pre">{item.freeformResponse}</dd>
                </div>
              ) : null}
            </dl>
          </DetailCard>
        </div>
      </div>
    </div>
  );
}
