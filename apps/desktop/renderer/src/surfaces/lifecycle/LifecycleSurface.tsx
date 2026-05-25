import { useUiState } from '@/app/ui-state.js';
import { useState } from 'react';
import { toast } from 'sonner';
import { CompanyCreationWizard } from './CompanyCreationWizard.js';
import { CompanySelectionPage } from './CompanySelectionPage.js';

type LifecycleMode = 'portal' | 'create';

/** Lifecycle surface root — level-0 full-screen takeover (rendered outside the
 *  AppFrame, so no topbar/nav chrome). Switches between the company-selection
 *  portal (default) and the company-creation wizard. */
export function LifecycleSurface() {
  const setCompany = useUiState((s) => s.setCompany);
  const setSurface = useUiState((s) => s.setSurface);
  const [mode, setMode] = useState<LifecycleMode>('portal');

  if (mode === 'create') {
    return (
      <CompanyCreationWizard
        onDismiss={() => setMode('portal')}
        onComplete={(company) => {
          // Build is simulated here; persisting the new company to SQLite is a
          // backend follow-up. Switch into the newly-built company + Office.
          setCompany(company.id);
          setSurface('office');
          toast.success(`Created ${company.name}`, {
            description: 'Your office is ready. Backing storage lands with the create command.',
          });
        }}
        onOpenStudio={() => {
          setSurface('studio');
          toast.success('Opening Studio editor', {
            description: 'Design your office layout from scratch.',
          });
        }}
      />
    );
  }

  return <CompanySelectionPage onNewCompany={() => setMode('create')} />;
}
