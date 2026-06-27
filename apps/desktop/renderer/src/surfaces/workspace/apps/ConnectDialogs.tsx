// Connect chat-creation + group-management dialogs (PR-05).
//
// `New chat` → Direct (pick one enabled employee) | New group (title + ≥1
// employee + reply policy). Group member settings edits membership + shows the
// reply policy. `Ask team` picks responders for a no-mention group message. All
// of these read the live employee roster and write ONLY through the Connect data
// mutations / the PR-03 controller — never the project-chat path.

import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { cn } from '@/lib/utils.js';
import type { CollaborationReplyPolicy } from '@offisim/shared-types';
import { Check, MessageSquare, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

/** Reply-policy options surfaced in the group dialogs (silent is not user-facing
 *  for a brand-new group — the two product modes are mentions-only + roundtable). */
const POLICY_OPTIONS: ReadonlyArray<{ value: CollaborationReplyPolicy; label: string }> = [
  { value: 'mentions_only', label: 'Mentions only' },
  { value: 'roundtable', label: 'Roundtable' },
];

export function policyLabel(policy: CollaborationReplyPolicy): string {
  if (policy === 'roundtable') return 'Roundtable';
  if (policy === 'silent') return 'Silent';
  return 'Mentions only';
}

function enabledEmployees(employees: readonly Employee[]): Employee[] {
  // A disabled employee stays in the roster but cannot be chatted to / added.
  return employees.filter((e) => !e.disabled);
}

function filterByQuery(employees: readonly Employee[], query: string): Employee[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...employees];
  return employees.filter(
    (e) => e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q),
  );
}

function EmployeeRow({
  employee,
  selected,
  onToggle,
}: {
  employee: Employee;
  selected: boolean;
  onToggle: () => void;
  multi: boolean;
}) {
  return (
    <button
      type="button"
      // Native <button> is already focusable/interactive; `aria-pressed` conveys
      // the selected state for both single + multi pick without a redundant role.
      aria-pressed={selected}
      className={cn('off-connect-pick-row off-focusable', selected && 'is-on')}
      onClick={onToggle}
    >
      <EmployeeAvatar
        seed={employee.id}
        appearance={employee.appearance}
        colorA={employee.avatarA}
        colorB={employee.avatarB}
        size={30}
        brand={employee.kind === 'external'}
      />
      <span className="off-connect-pick-copy">
        <span className="off-connect-pick-nm">{employee.name}</span>
        <span className="off-connect-pick-rl">{employee.role}</span>
      </span>
      {selected ? (
        <span className="off-connect-pick-check">
          <Icon icon={Check} size="sm" />
        </span>
      ) : null}
    </button>
  );
}

/* ── New chat: choose Direct vs Group ─────────────────────────────────────── */

export type NewChatKind = 'direct' | 'group';

export function NewChatTypeDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: NewChatKind) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent title="New chat" className="off-connect-dialog">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>
        <div className="off-connect-newtype">
          <button
            type="button"
            className="off-connect-newtype-btn off-focusable"
            onClick={() => onPick('direct')}
          >
            <span className="off-connect-newtype-ic">
              <Icon icon={MessageSquare} size="md" />
            </span>
            <span className="off-connect-newtype-copy">
              <span className="off-connect-newtype-nm">Direct message</span>
              <span className="off-connect-newtype-sub">Chat 1:1 with an employee</span>
            </span>
          </button>
          <button
            type="button"
            className="off-connect-newtype-btn off-focusable"
            onClick={() => onPick('group')}
          >
            <span className="off-connect-newtype-ic">
              <Icon icon={Users} size="md" />
            </span>
            <span className="off-connect-newtype-copy">
              <span className="off-connect-newtype-nm">New group</span>
              <span className="off-connect-newtype-sub">A team room with a reply policy</span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Direct picker ────────────────────────────────────────────────────────── */

export function DirectPickerDialog({
  open,
  employees,
  onClose,
  onPick,
}: {
  open: boolean;
  employees: readonly Employee[];
  onClose: () => void;
  onPick: (employee: Employee) => void;
}) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => filterByQuery(enabledEmployees(employees), query), [employees, query]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent title="Direct message" className="off-connect-dialog">
        <DialogHeader>
          <DialogTitle>Direct message</DialogTitle>
        </DialogHeader>
        <div className="off-connect-dialog-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or role" />
        </div>
        <div className="off-connect-pick-list" aria-label="Employees">
          {list.length === 0 ? (
            <div className="off-connect-pick-empty">No matching employees.</div>
          ) : (
            list.map((e) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                selected={false}
                multi={false}
                onToggle={() => onPick(e)}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── New group dialog ─────────────────────────────────────────────────────── */

export function NewGroupDialog({
  open,
  employees,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  employees: readonly Employee[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    employeeIds: string[];
    replyPolicy: CollaborationReplyPolicy;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<CollaborationReplyPolicy>('mentions_only');

  const pool = useMemo(() => enabledEmployees(employees), [employees]);
  const list = useMemo(() => filterByQuery(pool, query), [pool, query]);
  const byId = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chosen = [...selected];
  // Empty title falls back to a member-derived name so a group is never untitled.
  const derivedTitle =
    chosen
      .map((id) => byId.get(id)?.name)
      .filter((n): n is string => !!n)
      .slice(0, 3)
      .join(', ') || 'New group';
  const canCreate = chosen.length >= 1 && !busy;

  function reset(): void {
    setTitle('');
    setQuery('');
    setSelected(new Set());
    setPolicy('mentions_only');
  }

  function submit(): void {
    if (!canCreate) return;
    onCreate({
      title: title.trim() || derivedTitle,
      employeeIds: chosen,
      replyPolicy: policy,
    });
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent title="New group" className="off-connect-dialog is-group">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
        </DialogHeader>
        <label className="off-connect-field">
          <span className="off-connect-field-label">Title (optional)</span>
          <input
            className="off-connect-input off-focusable"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={derivedTitle}
            maxLength={120}
          />
        </label>
        <div className="off-connect-field">
          <span className="off-connect-field-label">Reply policy</span>
          <SegmentedControl
            options={POLICY_OPTIONS}
            value={policy}
            onChange={setPolicy}
            ariaLabel="Reply policy"
          />
          <span className="off-connect-field-hint">
            {policy === 'roundtable'
              ? 'Employees reply only when you Start a bounded round.'
              : 'Only @mentioned employees reply; otherwise use Ask team.'}
          </span>
        </div>
        <div className="off-connect-field">
          <span className="off-connect-field-label">
            Members{chosen.length > 0 ? ` · ${chosen.length}` : ''}
          </span>
          <div className="off-connect-dialog-search">
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name or role" />
          </div>
          <div className="off-connect-pick-list" aria-label="Group members">
            {list.length === 0 ? (
              <div className="off-connect-pick-empty">No matching employees.</div>
            ) : (
              list.map((e) => (
                <EmployeeRow
                  key={e.id}
                  employee={e}
                  selected={selected.has(e.id)}
                  multi
                  onToggle={() => toggle(e.id)}
                />
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="off-connect-btn off-focusable" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="off-connect-btn is-primary off-focusable"
            disabled={!canCreate}
            onClick={submit}
          >
            Create group
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Group member settings ────────────────────────────────────────────────── */

export interface GroupMemberView {
  memberId: string;
  employeeId: string | null;
  name: string;
}

export function GroupMembersDialog({
  open,
  title,
  policy,
  members,
  employees,
  busy,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  policy: CollaborationReplyPolicy;
  members: readonly GroupMemberView[];
  employees: readonly Employee[];
  busy?: boolean;
  onClose: () => void;
  onApply: (input: { addEmployeeIds: string[]; removeMemberIds: string[] }) => void;
}) {
  const [query, setQuery] = useState('');
  // Local edit set: start from the current active employee members.
  const initialActive = useMemo(
    () => new Set(members.filter((m) => m.employeeId).map((m) => m.employeeId as string)),
    [members],
  );
  const [active, setActive] = useState<Set<string>>(initialActive);
  // Re-sync the local edit set whenever the dialog opens or the underlying
  // membership changes (a member added/removed elsewhere while it was closed).
  const initialKey = [...initialActive].sort().join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialActive is an unmemoized Set ref (not added to avoid identity-churn loops); initialKey is an intentionally tracked derived value (stable string of membership) used to gate re-sync on real membership changes only.
  useEffect(() => {
    if (open) setActive(new Set(initialActive));
    // initialActive is derived from `members`; key the effect on the stable
    // string form so it re-syncs on real membership changes, not identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);

  const pool = useMemo(() => enabledEmployees(employees), [employees]);
  const list = useMemo(() => filterByQuery(pool, query), [pool, query]);
  const memberByEmployee = useMemo(
    () => new Map(members.filter((m) => m.employeeId).map((m) => [m.employeeId as string, m])),
    [members],
  );

  function toggle(id: string): void {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const addEmployeeIds = [...active].filter((id) => !initialActive.has(id));
  const removeMemberIds = [...initialActive]
    .filter((id) => !active.has(id))
    .map((id) => memberByEmployee.get(id)?.memberId)
    .filter((m): m is string => !!m);
  const remainingEmployees = active.size;
  const dirty = addEmployeeIds.length > 0 || removeMemberIds.length > 0;
  const canApply = dirty && remainingEmployees >= 1 && !busy;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent title="Group members" className="off-connect-dialog is-group">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="off-connect-members-meta">
          {remainingEmployees} member{remainingEmployees === 1 ? '' : 's'} · {policyLabel(policy)}
        </div>
        <div className="off-connect-dialog-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or role" />
        </div>
        <div className="off-connect-pick-list" aria-label="Group members">
          {list.length === 0 ? (
            <div className="off-connect-pick-empty">No matching employees.</div>
          ) : (
            list.map((e) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                selected={active.has(e.id)}
                multi
                onToggle={() => toggle(e.id)}
              />
            ))
          )}
        </div>
        {remainingEmployees < 1 ? (
          <div className="off-connect-field-hint is-warn">A group needs at least one member.</div>
        ) : null}
        <DialogFooter>
          <button type="button" className="off-connect-btn off-focusable" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="off-connect-btn is-primary off-focusable"
            disabled={!canApply}
            onClick={() => onApply({ addEmployeeIds, removeMemberIds })}
          >
            Save members
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Ask team picker ──────────────────────────────────────────────────────── */

export function AskTeamDialog({
  open,
  employees,
  onClose,
  onAsk,
}: {
  open: boolean;
  /** Active employee members of the group (already filtered to participants). */
  employees: readonly Employee[];
  onClose: () => void;
  onAsk: (responderEmployeeIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chosen = [...selected];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelected(new Set());
          onClose();
        }
      }}
    >
      <DialogContent title="Ask team" className="off-connect-dialog">
        <DialogHeader>
          <DialogTitle>Ask team</DialogTitle>
        </DialogHeader>
        <div className="off-connect-field-hint">
          Pick who should respond. With none chosen, the first teammate replies.
        </div>
        <div className="off-connect-pick-list" aria-label="Responders">
          {employees.length === 0 ? (
            <div className="off-connect-pick-empty">No employees in this group.</div>
          ) : (
            employees.map((e) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                selected={selected.has(e.id)}
                multi
                onToggle={() => toggle(e.id)}
              />
            ))
          )}
        </div>
        <DialogFooter>
          <button
            type="button"
            className="off-connect-btn off-focusable"
            onClick={() => {
              setSelected(new Set());
              onAsk([]);
            }}
          >
            First teammate
          </button>
          <button
            type="button"
            className="off-connect-btn is-primary off-focusable"
            disabled={chosen.length === 0}
            onClick={() => {
              onAsk(chosen);
              setSelected(new Set());
            }}
          >
            Ask {chosen.length > 0 ? `${chosen.length} ` : ''}selected
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
