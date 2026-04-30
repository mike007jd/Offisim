import { resolveRuntimeBindingFromInput, runtimeBindingsEqual } from '@offisim/core/browser';
import type { EmployeeRuntimeBinding } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Lock, Save } from 'lucide-react';
import { useMemo } from 'react';
import type { UseEmployeeEditorReturn } from '../../../hooks/useEmployeeEditor';
import { useCompanyEmployeeRuntimeDefault } from '../../../runtime/offisim-runtime-context.js';
import {
  RuntimeBindingControl,
  type RuntimeBindingResolvedSource,
} from '../../runtime/RuntimeBindingControl.js';
import { TabScrollShell } from './shared';

interface RuntimeTabProps {
  editor: UseEmployeeEditorReturn;
}

export function RuntimeTab({ editor }: RuntimeTabProps) {
  const { formData, isDirty, isSaving, updateField, save } = editor;
  const companyDefault = useCompanyEmployeeRuntimeDefault();

  const resolved = useMemo<{
    binding: EmployeeRuntimeBinding;
    source: RuntimeBindingResolvedSource;
  }>(() => {
    const policy = companyDefault ? { employeeRuntimeDefault: companyDefault } : null;
    const binding = resolveRuntimeBindingFromInput(
      { binding: formData.runtimeBinding, isExternal: false },
      policy,
    );
    const source: RuntimeBindingResolvedSource = formData.runtimeBinding
      ? 'override'
      : 'company-default';
    return { binding, source };
  }, [formData.runtimeBinding, companyDefault]);

  if (formData.isExternal) {
    return (
      <TabScrollShell>
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Lock className="h-3.5 w-3.5" />
          External A2A peer — routing handled by brand endpoint.
        </p>
      </TabScrollShell>
    );
  }

  const handleChange = (next: EmployeeRuntimeBinding | null) => {
    if (runtimeBindingsEqual(formData.runtimeBinding, next)) return;
    updateField('runtimeBinding', next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-32">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Execution binding
            </h3>
            <RuntimeBindingControl
              scope="employee"
              value={formData.runtimeBinding}
              onChange={handleChange}
              resolvedBinding={resolved.binding}
              resolvedSource={resolved.source}
            />
          </section>
        </div>
      </div>

      {isDirty && (
        <div className="shrink-0 border-t border-border-default bg-surface-elevated px-6 py-3 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-end gap-3">
            <Button size="sm" disabled={isSaving} onClick={save}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
