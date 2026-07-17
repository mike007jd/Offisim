import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { cn } from '@/lib/utils.js';
import { Check, Swords } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface CompetitiveDraftDialogProps {
  open: boolean;
  employees: readonly Employee[];
  objective: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (employeeIds: string[]) => void;
}

export function CompetitiveDraftDialog({
  open,
  employees,
  objective,
  busy,
  onOpenChange,
  onSubmit,
}: CompetitiveDraftDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!open) {
      setSelected([]);
      setSearch('');
    }
  }, [open]);
  const available = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees
      .filter((employee) => !employee.disabled)
      .filter(
        (employee) =>
          !query ||
          [employee.name, employee.role, employee.discipline, employee.modelLabel].some((value) =>
            value.toLowerCase().includes(query),
          ),
      );
  }, [employees, search]);

  const toggle = (employeeId: string) => {
    setSelected((current) => {
      if (current.includes(employeeId)) return current.filter((id) => id !== employeeId);
      if (current.length === 4) return current;
      return [...current, employeeId];
    });
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="off-competitive-draft-dialog" showClose={!busy}>
        <DialogHeader>
          <span className="off-competitive-draft-kicker">
            <Icon icon={Swords} size="sm" /> Competitive draft
          </span>
          <DialogTitle>Choose 2–4 employees</DialogTitle>
          <DialogDescription>
            Each employee gets an independent worktree. Their proposals will return here for a
            side-by-side review.
          </DialogDescription>
        </DialogHeader>
        <div className="off-competitive-draft-objective">{objective}</div>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search employees, roles, or models"
        />
        <div className="off-competitive-draft-roster" role="listbox" aria-multiselectable="true">
          {available.map((employee) => {
            const active = selected.includes(employee.id);
            const capped = !active && selected.length === 4;
            return (
              <button
                key={employee.id}
                type="button"
                role="option"
                aria-selected={active}
                className={cn('off-focusable', active && 'is-selected')}
                disabled={busy || capped}
                onClick={() => toggle(employee.id)}
              >
                <EmployeeAvatar
                  seed={employee.id}
                  colorA={employee.avatarA}
                  colorB={employee.avatarB}
                  appearance={employee.appearance}
                  brand={employee.kind === 'external'}
                  size={32}
                />
                <span>
                  <b>{employee.name}</b>
                  <small>{employee.role} · {employee.modelLabel}</small>
                </span>
                <span className="off-competitive-draft-check">
                  {active ? <Check aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <span>{selected.length}/4 selected</span>
          <button
            type="button"
            className="off-focusable"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="off-focusable is-primary"
            disabled={busy || selected.length < 2}
            onClick={() => onSubmit(selected)}
          >
            <Icon icon={Swords} size="sm" />
            {busy ? 'Starting…' : `Start ${selected.length} drafts`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
