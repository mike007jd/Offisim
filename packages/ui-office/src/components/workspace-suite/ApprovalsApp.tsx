import type { InteractionKind } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
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
  permission_request: { label: 'Permission', tone: 'bg-warn-surface text-warn' },
  plan_review: { label: 'Plan review', tone: 'bg-accent-surface text-accent' },
  agent_question: { label: 'Question', tone: 'bg-violet-surface text-violet' },
  skill_install_confirm: { label: 'Install', tone: 'bg-ok-surface text-ok' },
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
    <div className="flex h-full min-h-0 min-w-0">
      {/* List */}
      <div className="flex w-80 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex flex-col gap-2 border-b border-line-soft px-3 pb-2 pt-2.5">
          <span className="text-fs-md font-bold text-ink-1">Approvals</span>
          <div className="inline-flex h-8 items-center gap-0.5 self-start rounded-r-md border border-line bg-surface-2 p-1 shadow-elev-1">
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

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {filter === 'todo' ? (
            orderedPending.length === 0 ? (
              <p className="px-1 py-6 text-center text-fs-meta text-ink-4">
                Nothing waiting — no pending approvals.
              </p>
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
            <p className="px-1 py-6 text-center text-fs-meta text-ink-4">
              No resolved approvals yet.
            </p>
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
      <div className="grid min-h-0 min-w-0 flex-1">
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
          <div className="grid h-full place-items-center px-6 text-center text-fs-sm text-ink-4">
            Select an approval to review it.
          </div>
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
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-r-sm px-2.5 text-fs-meta font-semibold transition-colors',
        active
          ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring'
          : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
      )}
    >
      {label}
      {count != null && count > 0 ? (
        <span className="font-mono text-fs-micro opacity-80">{count}</span>
      ) : null}
    </Button>
  );
}

function KindBadge({ kind }: { kind: InteractionKind }) {
  const meta = KIND_META[kind];
  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          'rounded-r-xs px-1.5 py-0.5 text-fs-micro font-bold uppercase tracking-wide',
          meta.tone,
        )}
      >
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
      className={cn(
        'grid h-auto w-full justify-start gap-1.5 rounded-r-md border border-transparent px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent-ring bg-accent-surface' : 'hover:bg-surface-sunken',
      )}
    >
      <KindBadge kind={item.kind} />
      <span className="text-fs-sm font-semibold leading-snug text-ink-1">{item.request.title}</span>
      <span className="flex items-center gap-1.5 text-fs-micro text-ink-3">
        {agent ? (
          <span className="size-4 overflow-hidden rounded-full ring-1 ring-line">
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
      className={cn(
        'grid h-auto w-full justify-start gap-1.5 rounded-r-md border border-transparent px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent-ring bg-accent-surface' : 'hover:bg-surface-sunken',
      )}
    >
      <KindBadge kind={item.kind} />
      <span className="text-fs-sm font-semibold leading-snug text-ink-1">{item.request.title}</span>
      <span className="flex items-center gap-1.5 text-fs-micro text-ink-3">
        <Check className="size-3 text-ok" aria-hidden="true" />
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
    <div className="border-b border-line-soft px-7 py-5">
      <span
        className={cn(
          'inline-flex items-center rounded-r-xs px-2 py-0.5 text-fs-micro font-bold uppercase tracking-wide',
          meta.tone,
        )}
      >
        {meta.label}
      </span>
      <div className="mt-2 text-fs-lg font-bold text-ink-1">{title}</div>
      {employeeName ? (
        <div className="mt-1 flex items-center gap-1.5 text-fs-meta text-ink-3">
          From {employeeName}
        </div>
      ) : null}
    </div>
  );
}

function DetailCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-r-md border border-line-soft bg-surface-2 p-5 shadow-elev-1">
      <div className="mb-2 text-fs-micro font-bold uppercase tracking-widest text-ink-3">
        {label}
      </div>
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
    <div className="flex min-h-0 flex-col">
      <DetailHead kind={item.kind} title={item.request.title} employeeName={employeeName} />
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
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
          <div className="flex flex-col gap-4">
            <DetailCard label="Request">
              <p className="whitespace-pre-wrap text-fs-sm leading-relaxed text-ink-2">
                {item.request.prompt}
              </p>
            </DetailCard>
            <div className="flex flex-col gap-2 rounded-r-md border border-line-soft bg-surface-2 p-5 text-fs-sm text-ink-3">
              <p>
                This gate is waiting in another conversation. Open its thread to review and resolve
                it inline — resolving routes through the standard interaction path.
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={onOpenThread}
                className="inline-flex h-8 w-fit items-center gap-2 rounded-r-sm bg-accent px-3.5 text-fs-sm font-semibold text-accent-fg transition-colors hover:bg-accent-press"
              >
                <MessageSquare className="size-3.5" aria-hidden="true" />
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
    <div className="flex min-h-0 flex-col">
      <DetailHead kind={item.kind} title={item.request.title} employeeName={employeeName} />
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="flex flex-col gap-4">
          <DetailCard label="Request">
            <p className="whitespace-pre-wrap text-fs-sm leading-relaxed text-ink-2">
              {item.request.prompt}
            </p>
          </DetailCard>
          <DetailCard label="Resolution">
            <dl className="flex flex-col gap-2 text-fs-sm">
              <div className="flex gap-4">
                <dt className="w-28 shrink-0 text-ink-3">Status</dt>
                <dd className="m-0 min-w-0 flex-1 font-medium capitalize text-ink-1">
                  {item.status}
                </dd>
              </div>
              {item.selectedOptionId ? (
                <div className="flex gap-4">
                  <dt className="w-28 shrink-0 text-ink-3">Decision</dt>
                  <dd className="m-0 min-w-0 flex-1 font-medium text-ink-1">
                    {item.selectedOptionId}
                  </dd>
                </div>
              ) : null}
              {item.freeformResponse ? (
                <div className="flex gap-4">
                  <dt className="w-28 shrink-0 text-ink-3">Note</dt>
                  <dd className="m-0 min-w-0 flex-1 whitespace-pre-wrap text-ink-1">
                    {item.freeformResponse}
                  </dd>
                </div>
              ) : null}
            </dl>
          </DetailCard>
        </div>
      </div>
    </div>
  );
}
