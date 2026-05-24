import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import {
  CompanyProvider,
  NotificationProvider,
  PlanStepStoreProvider,
  ThemeProvider,
  useOffisimRuntimeServices,
} from '@offisim/ui-office/web';
import {
  readStoredActiveCompany,
  restoreStoredActiveCompany,
  storeActiveCompany,
} from './lib/active-company-storage';
import { installThreeConsoleFilter } from './lib/three-console';
import { BootstrapProvider } from './runtime/BootstrapProvider';
import { OffisimRuntimeProvider } from './runtime/OffisimRuntimeProvider';
import {
  isTauriDevEphemeralEnabled,
  useTauriDevEphemeralReset,
} from './runtime/tauri-dev-ephemeral';

const App = lazy(() => import('./App.js').then((module) => ({ default: module.App })));

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
  const { repos } = useOffisimRuntimeServices();
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
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isRestoringCompany, setIsRestoringCompany] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (isResettingDevData) {
      setIsRestoringCompany(true);
      return () => {
        cancelled = true;
      };
    }

    const restoreCompany = async () => {
      if (isTauriDevEphemeralEnabled()) {
        if (!cancelled) {
          setCompanyId(null);
          setIsRestoringCompany(false);
        }
        return;
      }

      setIsRestoringCompany(true);
      try {
        const storedCompanyId = readStoredActiveCompany();
        const restoredCompanyId = storedCompanyId ? await restoreStoredActiveCompany() : null;
        if (cancelled) return;
        setCompanyId(restoredCompanyId);
      } catch (error) {
        console.error('[Shell] failed to restore the active company:', error);
        if (cancelled) return;
        setCompanyId(null);
      } finally {
        if (!cancelled) {
          setIsRestoringCompany(false);
        }
      }
    };

    void restoreCompany();

    return () => {
      cancelled = true;
    };
  }, [isResettingDevData]);

  const handleCompanySwitch = useCallback((id: string | null) => {
    storeActiveCompany(id);
    setCompanyId(id);
  }, []);

  if (isResettingDevData || isRestoringCompany) {
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
          <PlanStepStoreProvider>
            <NotificationProvider>
              <Suspense fallback={<AppBootFallback />}>
                <App onCompanySwitch={handleCompanySwitch} />
              </Suspense>
            </NotificationProvider>
          </PlanStepStoreProvider>
        </BootstrapProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <OffisimRuntimeProvider key={companyId} companyId={companyId}>
        <CompanyBridge activeCompanyId={companyId} onCompanySwitch={handleCompanySwitch}>
          <PlanStepStoreProvider>
            <NotificationProvider>
              <Suspense fallback={<AppBootFallback />}>
                <App onCompanySwitch={handleCompanySwitch} />
              </Suspense>
            </NotificationProvider>
          </PlanStepStoreProvider>
        </CompanyBridge>
      </OffisimRuntimeProvider>
    </ThemeProvider>
  );
}

function AppBootFallback() {
  return <div className="flex min-h-screen items-center justify-center bg-surface text-ink-3" />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

installThreeConsoleFilter();

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
