import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { initializeDeepLinkInstallBridge } from './app/DeepLinkInstallBridge.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import { StartupGate } from './app/StartupGate.js';
import { recordLastError } from './app/last-error.js';
import { AppProviders } from './app/providers/AppProviders.js';

window.addEventListener('error', (e) => recordLastError('window.error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) =>
  recordLastError('unhandledrejection', e.reason),
);
void initializeDeepLinkInstallBridge();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const markBootguardReadyWhenContentPaints = () => {
  const bootguard = window as Window & {
    __OFFISIM_BOOTGUARD_READY?: () => void;
  };
  let attempts = 0;
  const markWhenReady = () => {
    attempts += 1;
    const hasRenderedText = (root.textContent ?? '').trim().length > 0;
    const hasRenderedElement = root.childElementCount > 0;
    if (hasRenderedText && hasRenderedElement) {
      bootguard.__OFFISIM_BOOTGUARD_READY?.();
      return;
    }
    if (attempts < 120) {
      window.setTimeout(markWhenReady, 250);
    }
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(markWhenReady));
};

try {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <AppProviders>
          <StartupGate />
        </AppProviders>
      </ErrorBoundary>
    </StrictMode>,
  );
  markBootguardReadyWhenContentPaints();
} catch (error) {
  recordLastError('renderer.render', error);
  throw error;
}
