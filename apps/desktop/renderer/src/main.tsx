import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import { AppProviders } from './app/providers/AppProviders.js';

// Persist uncaught errors to localStorage (WKWebView persists it to disk) so
// runtime failures are diagnosable headlessly in the release app.
function recordError(label: string, detail: unknown) {
  try {
    localStorage.setItem('offisim:lastError', `${label}: ${String(detail)}`);
  } catch {
    /* localStorage unavailable */
  }
}
window.addEventListener('error', (e) => recordError('window.error', e.error?.stack ?? e.message));
window.addEventListener('unhandledrejection', (e) =>
  recordError('unhandledrejection', (e.reason as Error)?.stack ?? e.reason),
);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
);
