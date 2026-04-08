import type { ProviderConfig } from '../../lib/provider-config';
import { Button, Dialog, DialogContent } from '@offisim/ui-core';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type SettingsTab,
  SettingsWorkspaceSurface,
  useSettingsWorkspaceController,
} from './SettingsWorkspaceSurface';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
}

export function SettingsDialog({ open, onOpenChange, onSave, onSaveSuccess }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('provider');
  const controller = useSettingsWorkspaceController({
    isActive: open,
    closeOnSave: true,
    onDismiss: () => onOpenChange(false),
    onSave,
    onSaveSuccess,
  });

  useEffect(() => {
    if (open) {
      setActiveTab('provider');
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        controller.requestDismiss();
      }}
    >
      <DialogContent
        className="h-[min(920px,calc(100vh-24px))] w-[min(1480px,calc(100vw-24px))] max-w-none overflow-hidden border border-white/10 bg-transparent p-0 text-slate-100 shadow-[0_30px_120px_rgba(0,0,0,0.52)]"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          controller.requestDismiss();
        }}
      >
        <SettingsWorkspaceSurface
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          controller={controller}
          dismissControl={
            <Button
              type="button"
              variant="ghost"
              onClick={controller.requestDismiss}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
