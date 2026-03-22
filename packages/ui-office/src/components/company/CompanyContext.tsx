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
}

export function CompanyProvider({ repos, children }: CompanyProviderProps) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const refreshCompanies = useCallback(async () => {
    if (!repos) return;
    const all = await repos.companies.findAll();
    setCompanies(all);
    // Auto-select first company if none selected (use functional update to avoid stale closure)
    const first = all[0];
    setActiveCompanyId((prev) => (prev == null && first != null) ? first.company_id : prev);
  }, [repos]);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const switchCompany = useCallback((id: string) => {
    setActiveCompanyId(id);
  }, []);

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
