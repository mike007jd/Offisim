import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import { recordLastError } from './app/last-error.js';
import { AppProviders } from './app/providers/AppProviders.js';

window.addEventListener('error', (e) =>
  recordLastError('window.error', e.error ?? e.message),
);
window.addEventListener('unhandledrejection', (e) =>
  recordLastError('unhandledrejection', e.reason),
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
