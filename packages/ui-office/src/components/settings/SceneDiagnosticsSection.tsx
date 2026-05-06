import { Button } from '@offisim/ui-core';
import { useCallback } from 'react';
import { exportJsonText } from '../../lib/json-export';
import { exportLatest } from '../scene/office-2d-drop-diagnostic';
import { SettingsSection } from './settings-primitives';

interface SceneDiagnosticsSectionProps {
  notify: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

export function SceneDiagnosticsSection({ notify }: SceneDiagnosticsSectionProps) {
  const handleExport = useCallback(async () => {
    const json = exportLatest();
    const filename = `offisim-2d-drop-diagnostic-${Date.now()}.json`;
    try {
      const saved = await exportJsonText(filename, json);
      if (saved === null) return;
      notify('2D drop diagnostic exported.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [notify]);

  return (
    <SettingsSection
      title="2D scene diagnostics"
      description="Export the last 10 employee→zone drag attempts (PointerEvent stream, hit results, drop decision) as JSON for incident debugging."
    >
      <div>
        <Button type="button" variant="outline" size="sm" onClick={handleExport}>
          Export 2D drop diagnostic
        </Button>
      </div>
    </SettingsSection>
  );
}
