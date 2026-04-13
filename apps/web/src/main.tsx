import { StrictMode, Suspense, lazy, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  CompanyProvider,
  NotificationProvider,
  ThemeProvider,
  useOffisimRuntime,
} from '@offisim/ui-office/web';
import { installThreeConsoleFilter } from './lib/three-console';
import { BootstrapProvider } from './runtime/BootstrapProvider';
import { OffisimRuntimeProvider } from './runtime/OffisimRuntimeProvider';
import { DevAutoSmokeBootstrap } from './runtime/dev-auto-smoke';
import { installVaultSmokePlaceholder } from './runtime/install-vault-smoke-placeholder';
import {
  isTauriDevEphemeralEnabled,
  useTauriDevEphemeralReset,
} from './runtime/tauri-dev-ephemeral';

const App = lazy(() => import('./App.js').then((module) => ({ default: module.App })));

/** Persist active company across page reloads. */
const STORAGE_KEY = 'offisim:active-company';

function readStoredCompany(): string | null {
  if (isTauriDevEphemeralEnabled()) {
    return null;
  }
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
  const isResettingDevData = useTauriDevEphemeralReset();
  const [companyId, setCompanyId] = useState(readStoredCompany);

  const handleCompanySwitch = useCallback((id: string | null) => {
    storeCompany(id);
    setCompanyId(id);
  }, []);

  if (isResettingDevData) {
    return (
      <ThemeProvider>
        <AppBootFallback />
      </ThemeProvider>
    );
  }

  if (!companyId) {
    return (
      <ThemeProvider>
        <BootstrapProvider>
          <DevAutoSmokeBootstrap onCompanyCreated={handleCompanySwitch} />
          <NotificationProvider>
            <Suspense fallback={<AppBootFallback />}>
              <App onCompanySwitch={handleCompanySwitch} />
            </Suspense>
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
            <Suspense fallback={<AppBootFallback />}>
              <App onCompanySwitch={handleCompanySwitch} />
            </Suspense>
          </NotificationProvider>
        </CompanyBridge>
      </OffisimRuntimeProvider>
    </ThemeProvider>
  );
}

function AppBootFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400" />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

installThreeConsoleFilter();
installVaultSmokePlaceholder();

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
