import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

const App = lazy(() => import('./App.js').then((module) => ({ default: module.App })));

function AppBootFallback() {
  return <main data-offisim-design-reset-root="" />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<AppBootFallback />}>
      <App onCompanySwitch={() => {}} />
    </Suspense>
  </StrictMode>,
);
