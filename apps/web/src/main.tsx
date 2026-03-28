import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  CompanyProvider,
  NotificationProvider,
  ThemeProvider,
  useOffisimRuntime,
} from '@offisim/ui-office';
import { App } from './App.js';
import { installThreeConsoleFilter } from './lib/three-console';
import { OffisimRuntimeProvider } from './runtime/OffisimRuntimeProvider';

/** Default company ID used to seed the initial runtime. */
const DEFAULT_COMPANY_ID = 'company-001';

/** Persist active company across page reloads. */
const STORAGE_KEY = 'offisim:active-company';

function readStoredCompany(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_COMPANY_ID;
}

function storeCompany(id: string) {
  localStorage.setItem(STORAGE_KEY, id);
}

/**
 * Wrapper that provides CompanyContext powered by runtime repos.
 * Receives controlled `activeCompanyId` + `onCompanySwitch` from parent
 * so company switching propagates up to re-key OffisimRuntimeProvider.
 */
function CompanyBridge({
  children,
  activeCompanyId,
  onCompanySwitch,
}: {
  children: React.ReactNode;
  activeCompanyId: string;
  onCompanySwitch: (id: string) => void;
}) {
  const { repos } = useOffisimRuntime();
  return (
    <CompanyProvider
      repos={repos}
      activeCompanyId={activeCompanyId}
      onCompanySwitch={onCompanySwitch}
    >
      {children}
    </CompanyProvider>
  );
}

/**
 * Root shell — owns the active company ID state.
 * Keying OffisimRuntimeProvider on `companyId` ensures a full runtime
 * teardown + re-init when the user switches companies.
 */
function Shell() {
  const [companyId, setCompanyId] = useState(readStoredCompany);

  const handleCompanySwitch = useCallback((id: string) => {
    storeCompany(id);
    setCompanyId(id);
  }, []);

  return (
    <ThemeProvider>
      <OffisimRuntimeProvider key={companyId} companyId={companyId}>
        <CompanyBridge activeCompanyId={companyId} onCompanySwitch={handleCompanySwitch}>
          <NotificationProvider>
            <App onCompanySwitch={handleCompanySwitch} />
          </NotificationProvider>
        </CompanyBridge>
      </OffisimRuntimeProvider>
    </ThemeProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

installThreeConsoleFilter();

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
