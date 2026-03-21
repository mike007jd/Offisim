import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.js';
import { NotificationProvider, ThemeProvider } from '@aics/ui-office';
import { AicsRuntimeProvider } from './runtime/AicsRuntimeProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AicsRuntimeProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </AicsRuntimeProvider>
    </ThemeProvider>
  </StrictMode>,
);
