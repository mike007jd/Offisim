import { TooltipProvider } from '@/design-system/primitives/tooltip.js';
import { useNativeEscapeBridge } from '@/lib/native-escape-bridge.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 15_000,
          },
        },
      }),
  );

  useNativeEscapeBridge();

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>{children}</TooltipProvider>
        {/* top-right kept from 4b5a1b79 (banner owns a real layout row now, no
            stacking conflict). WKWebView (WebKit 26) can drop sonner's compositing
            layer entirely in ship builds — surfaces.css pins [data-sonner-toaster]
            to a stable layer and converts entry to an in-place fade. The offset
            clears the topbar so toasts never cover navigation (sonner writes the
            string verbatim into --offset-top, so calc+var resolves at runtime). */}
        <Toaster
          closeButton
          position="top-right"
          offset={{ top: 'calc(var(--off-toolbar) + var(--off-sp-3))', right: 'var(--off-sp-5)' }}
          toastOptions={{
            classNames: {
              toast: 'off-toast',
              title: 'off-toast-title',
              description: 'off-toast-description',
              actionButton: 'off-toast-action',
              cancelButton: 'off-toast-cancel',
              closeButton: 'off-toast-close',
            },
          }}
        />
      </MotionConfig>
    </QueryClientProvider>
  );
}
