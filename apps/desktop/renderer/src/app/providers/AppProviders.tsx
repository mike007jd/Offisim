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
        {/* top-right: WKWebView (macOS 26) fails to paint sonner's bottom-anchored
            slide-in layer even though the DOM/CSSOM is correct (toast mounts with
            opacity 1 at the right rect but never composites). Top-anchored toasts
            paint fine. The banner now owns a real layout row (shell.css), so
            top-right toasts no longer stack onto persistent controls. */}
        <Toaster
          closeButton
          position="top-right"
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
