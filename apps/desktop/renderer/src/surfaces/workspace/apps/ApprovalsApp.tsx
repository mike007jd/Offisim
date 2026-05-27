import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Check, CheckSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  GATE_HEAD_LABEL,
  GATE_LABEL,
  type GateKind,
  type GrantScope,
  type WsApproval,
  useWsApprovals,
} from '../workspace-data.js';

type Segment = 'todo' | 'done' | 'ccd' | 'announce';

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'done', label: 'Done' },
  { value: 'ccd', label: "CC'd" },
  { value: 'announce', label: 'Announce' },
];

const SCOPE_OPTIONS: ReadonlyArray<{ value: GrantScope; label: string }> = [
  { value: 'once', label: 'Once' },
  { value: 'thread', label: 'This thread' },
  { value: 'session', label: 'This session' },
];

const TYPE_CLASS: Record<GateKind, string> = {
  permission: 'is-perm',
  plan: 'is-plan',
  ask: 'is-ask',
  install: 'is-install',
};

const SCOPE_LABEL: Record<GrantScope, string> = {
  once: 'once',
  thread: 'thread',
  session: 'session',
};

function Row({
  a,
  byId,
  activeId,
  onSelect,
}: {
  a: WsApproval;
  byId: Map<string, Employee>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const requester = byId.get(a.requesterId);
  return (
    <button
      type="button"
      className={cn('off-ws-oa-row off-focusable', a.id === activeId && 'is-active')}
      onClick={() => onSelect(a.id)}
    >
      <span className="off-ws-oa-r1">
        <span className={cn('off-ws-oa-type', TYPE_CLASS[a.kind])}>{GATE_LABEL[a.kind]}</span>
        <span className="off-ws-oa-age">{a.ageLabel}</span>
      </span>
      <span className="off-ws-oa-ttl">{a.title}</span>
      {a.status === 'pending' ? (
        <span className="off-ws-oa-from">
          {requester ? (
            <EmployeeAvatar
              seed={requester.id}
              appearance={requester.appearance}
              colorA={requester.avatarA}
              colorB={requester.avatarB}
              size={16}
              brand={requester.kind === 'external'}
            />
          ) : null}
          {requester?.name ?? 'Unknown'} · {a.requesterRole}
        </span>
      ) : (
        <span className="off-ws-oa-from is-resolved">
          <Icon icon={Check} size="sm" />
          {a.status === 'approved' ? 'Approved' : 'Denied'} · {SCOPE_LABEL[a.scope]} scope
        </span>
      )}
    </button>
  );
}

export function ApprovalsApp() {
  const approvals = useWsApprovals();
  const employees = useEmployees();
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const [segment, setSegment] = useState<Segment>('todo');

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const list: WsApproval[] = approvals.data ?? [];

  const pending = list.filter((a) => a.status === 'pending');
  const resolved = list.filter((a) => a.status !== 'pending');

  // To do shows pending plus resolved-today; other segments stay empty until their feeds exist.
  const visible = segment === 'todo' ? list : [];
  const activeId =
    selectedId && visible.some((a) => a.id === selectedId)
      ? selectedId
      : (pending[0]?.id ?? visible[0]?.id ?? null);
  const active = list.find((a) => a.id === activeId) ?? null;
  const activeScope = active?.scope ?? 'thread';

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head off-ws-list-head-col">
          <span className="off-ws-list-title">Approvals</span>
          <SegmentedControl
            options={SEGMENTS.map((s) => ({
              value: s.value,
              label:
                s.value === 'todo' ? (
                  <>
                    {s.label}
                    <span className="off-ws-seg-ct">{pending.length}</span>
                  </>
                ) : (
                  s.label
                ),
            }))}
            value={segment}
            onChange={setSegment}
            ariaLabel="Approval segments"
          />
        </div>
        <div className="off-ws-oa-rows">
          {segment === 'todo' ? (
            <>
              {pending.map((a) => (
                <Row key={a.id} a={a} byId={byId} activeId={activeId} onSelect={selectItem} />
              ))}
              {resolved.length > 0 ? (
                <>
                  <div className="off-ws-im-sec">Resolved today</div>
                  {resolved.map((a) => (
                    <Row key={a.id} a={a} byId={byId} activeId={activeId} onSelect={selectItem} />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={CheckSquare}
              title={`Nothing in ${SEGMENTS.find((s) => s.value === segment)?.label}`}
              description="Approvals you’ve handled or been copied on show up here."
            />
          )}
        </div>
      </div>

      <div className="off-ws-detail off-ws-oa-detail">
        {active ? (
          <>
            <div className="off-ws-oa-d-head">
              <span className="off-ws-oa-d-type">
                <span className={cn('off-ws-oa-type', TYPE_CLASS[active.kind])}>
                  {GATE_HEAD_LABEL[active.kind]}
                </span>
                <span className="off-ws-oa-age">
                  requested {active.ageLabel} ago
                  {active.expiresLabel ? ` · ${active.expiresLabel}` : ''}
                </span>
              </span>
              <h2 className="off-ws-oa-d-ttl">{active.title}</h2>
              <div className="off-ws-oa-d-sub">
                {(() => {
                  const r = byId.get(active.requesterId);
                  return r ? (
                    <EmployeeAvatar
                      seed={r.id}
                      appearance={r.appearance}
                      colorA={r.avatarA}
                      colorB={r.avatarB}
                      size={18}
                      brand={r.kind === 'external'}
                    />
                  ) : null;
                })()}
                {byId.get(active.requesterId)?.name ?? '—'} · {active.requesterRole} · in{' '}
                <b>{active.threadName}</b>
              </div>
            </div>

            <div className="off-ws-oa-d-body">
              <div className="off-ws-oa-card">
                <div className="off-ws-oa-card-h">Request</div>
                <dl className="off-ws-oa-kv">
                  {active.request.map((kv) => (
                    <div key={kv.label} className="off-ws-oa-kv-row">
                      <dt>{kv.label}</dt>
                      <dd>{kv.mono ? <code>{kv.value}</code> : kv.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {active.command ? (
                <div className="off-ws-oa-card">
                  <div className="off-ws-oa-card-h">Command</div>
                  <pre className="off-ws-oa-cmd">{active.command}</pre>
                </div>
              ) : null}

              <div className="off-ws-oa-card">
                <div className="off-ws-oa-card-h">Why it’s asking</div>
                <p className="off-ws-oa-reason">{active.reason}</p>
              </div>

              {active.status === 'pending' ? (
                <div>
                  <div className="off-ws-oa-scope-h">Grant scope</div>
                  <div className="off-seg" aria-label="Grant scope">
                    {SCOPE_OPTIONS.map((option) => (
                      <span
                        key={option.value}
                        data-selected={option.value === activeScope ? 'true' : undefined}
                        className={cn('off-seg-btn', option.value === activeScope && 'is-on')}
                      >
                        {option.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="off-ws-oa-foot">
              <span className="off-ws-oa-foot-note">
                {active.status === 'pending'
                  ? 'Approval is read-only until a runtime interaction target exists.'
                  : `Resolved · ${SCOPE_LABEL[active.scope]} scope`}
              </span>
              {active.status === 'pending' ? (
                <span className="off-ws-action-state">Awaiting runtime interaction target</span>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            icon={CheckSquare}
            title="No approval selected"
            description="Pick a request to review."
          />
        )}
      </div>
    </>
  );
}
