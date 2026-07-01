import { useUiState } from '@/app/ui-state.js';
import { useCompanies } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { activateCompanyScope } from '@/runtime/activate-company-scope.js';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { toast } from 'sonner';

function companyBadgeStyle(company: { accentA: string; accentB: string }): CSSProperties {
  return {
    '--off-scope-badge-a': company.accentA,
    '--off-scope-badge-b': company.accentB,
  } as CSSProperties;
}

export function ScopeBar() {
  const companyId = useUiState((s) => s.companyId);
  const setScope = useUiState((s) => s.setScope);
  const openLifecycle = useUiState((s) => s.openLifecycle);

  const companies = useCompanies();
  const [switchingCompanyId, setSwitchingCompanyId] = useState<string | null>(null);

  const activeCompany = companies.data?.find((c) => c.id === companyId);

  async function switchCompany(nextCompanyId: string) {
    if (switchingCompanyId) return;
    setSwitchingCompanyId(nextCompanyId);
    try {
      await activateCompanyScope({ companyId: nextCompanyId, setScope });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Company switch failed');
    } finally {
      setSwitchingCompanyId(null);
    }
  }

  return (
    <div className="off-scope-bar">
      <DropdownMenu>
        <DropdownMenuTrigger className="off-scope-seg off-focusable" aria-label="Switch company">
          {activeCompany ? (
            <span className="off-scope-badge" style={companyBadgeStyle(activeCompany)}>
              {activeCompany.initials}
            </span>
          ) : null}
          <span className="off-scope-name">{activeCompany?.name ?? 'Select company'}</span>
          <Icon icon={ChevronDown} size="sm" className="off-scope-caret" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Companies</DropdownMenuLabel>
          {companies.data?.map((company) => (
            <DropdownMenuItem
              key={company.id}
              disabled={switchingCompanyId !== null}
              onSelect={() => void switchCompany(company.id)}
            >
              <span className="off-scope-badge" style={companyBadgeStyle(company)}>
                {company.initials}
              </span>
              <span className="grow">{company.name}</span>
              {company.id === companyId ? (
                <Icon icon={Check} size="sm" className="off-scope-check" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openLifecycle('select')}>
            <Icon icon={Building2} size="sm" />
            All companies…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openLifecycle('create')}>
            <Icon icon={Plus} size="sm" />
            New company
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
