import { useUiState } from '@/app/ui-state.js';
import type { Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { ChevronDown, User, Users } from 'lucide-react';

/**
 * Draft-only recipient row ("To: …"), rendered along the composer's top edge —
 * the messaging-compose convention. Conversation scope (team vs one teammate)
 * is fixed at the draft's first message, so the row exists only while the
 * thread is still a draft; afterwards the input placeholder ("Message Ryan
 * Torres") carries the recipient and the row disappears — never a fake
 * mid-thread switch.
 */
export function DraftRecipientRow({
  scopeEmployeeId,
  employees,
}: {
  scopeEmployeeId: string | null;
  employees: readonly Employee[];
}) {
  const setDraftEmployee = useUiState((s) => s.setDraftEmployee);
  const current = scopeEmployeeId ? employees.find((e) => e.id === scopeEmployeeId) : null;
  const label = current ? current.name : 'Whole team';
  const ScopeIcon = current ? User : Users;

  return (
    <div className="off-composer-to-row">
      <span className="off-composer-to-label">To</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="off-composer-chip off-focusable"
            aria-label="Conversation recipient"
          >
            <Icon icon={ScopeIcon} size="sm" />
            <span className="off-composer-chip-text">{label}</span>
            <Icon icon={ChevronDown} size="sm" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="off-composer-menu">
          <DropdownMenuLabel>Send to</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={scopeEmployeeId ?? ''}
            onValueChange={(value) => setDraftEmployee(value || null)}
          >
            <DropdownMenuRadioItem value="">Whole team</DropdownMenuRadioItem>
            {employees.map((employee) => (
              <DropdownMenuRadioItem key={employee.id} value={employee.id}>
                <span className="off-composer-menu-row">
                  <span className="off-composer-menu-name">{employee.name}</span>
                  <span className="off-composer-menu-meta">{employee.role}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
