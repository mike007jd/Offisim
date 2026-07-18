import { useUiState } from '@/app/ui-state.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { useEffect } from 'react';
import { toast } from 'sonner';

export function UpdateNotifier() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void invokeCommand('app_update_check')
        .then((status) => {
          if (status.status !== 'available') return;
          toast.info(`Offisim ${status.latestVersion} is available`, {
            description: 'A signed update is ready. Install it when convenient.',
            duration: 12_000,
            action: {
              label: 'View update',
              onClick: () => useUiState.getState().openSettings('updates'),
            },
          });
        })
        .catch(() => undefined);
    }, 4_500);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
