import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.js';
import { CompanyProvider, NotificationProvider, ThemeProvider, useAicsRuntime } from '@aics/ui-office';
import { AicsRuntimeProvider } from './runtime/AicsRuntimeProvider';

/** Default company ID used to seed the initial runtime. */
const DEFAULT_COMPANY_ID = 'company-001';

/** Wrapper that provides CompanyContext powered by runtime repos. */
function CompanyBridge({ children }: { children: React.ReactNode }) {
  const { repos } = useAicsRuntime();
  return <CompanyProvider repos={repos}>{children}</CompanyProvider>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AicsRuntimeProvider companyId={DEFAULT_COMPANY_ID}>
        <CompanyBridge>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </CompanyBridge>
      </AicsRuntimeProvider>
    </ThemeProvider>
  </StrictMode>,
);
