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
import { BootstrapProvider } from './runtime/BootstrapProvider';
import { OffisimRuntimeProvider } from './runtime/OffisimRuntimeProvider';

/** Persist active company across page reloads. */
const STORAGE_KEY = 'offisim:active-company';

function readStoredCompany(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function storeCompany(id: string | null) {
  if (id) {
    localStorage.setItem(STORAGE_KEY, id);
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
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
  onCompanySwitch: (id: string | null) => void;
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

  const handleCompanySwitch = useCallback((id: string | null) => {
    storeCompany(id);
    setCompanyId(id);
  }, []);

  if (!companyId) {
    return (
      <ThemeProvider>
        <BootstrapProvider>
          <NotificationProvider>
            <App onCompanySwitch={handleCompanySwitch} />
          </NotificationProvider>
        </BootstrapProvider>
      </ThemeProvider>
    );
  }

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
