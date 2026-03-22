import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CompanyRow, RuntimeRepositories } from '@aics/core/browser';

interface CompanyContextValue {
  activeCompanyId: string | null;
  companies: CompanyRow[];
  switchCompany: (id: string) => void;
  refreshCompanies: () => void;
}

const CompanyCtx = createContext<CompanyContextValue | null>(null);

interface CompanyProviderProps {
  repos: RuntimeRepositories | null;
  children: ReactNode;
  /** Controlled active company ID — when provided, CompanyProvider defers to the parent. */
  activeCompanyId?: string | null;
  /** Called when user triggers switchCompany — lets the parent lift state above the runtime. */
  onCompanySwitch?: (id: string) => void;
}

export function CompanyProvider({ repos, children, activeCompanyId: controlledId, onCompanySwitch }: CompanyProviderProps) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [internalId, setInternalId] = useState<string | null>(null);

  // If parent provides controlledId, use it; otherwise fall back to internal state
  const activeCompanyId = controlledId !== undefined ? controlledId : internalId;

  const refreshCompanies = useCallback(async () => {
    if (!repos) return;
    const all = await repos.companies.findAll();
    setCompanies(all);
    // Auto-select first company if none selected (only for uncontrolled mode)
    if (controlledId === undefined) {
      const first = all[0];
      setInternalId((prev) => (prev == null && first != null) ? first.company_id : prev);
    }
  }, [repos, controlledId]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const switchCompany = useCallback((id: string) => {
    if (onCompanySwitch) {
      onCompanySwitch(id);
    } else {
      setInternalId(id);
    }
  }, [onCompanySwitch]);

  return (
    <CompanyCtx.Provider value={{ activeCompanyId, companies, switchCompany, refreshCompanies }}>
      {children}
    </CompanyCtx.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyCtx);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
