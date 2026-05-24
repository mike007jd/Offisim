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
import { ToolPermissionEditor } from '../ToolPermissionEditor';
import { PersonnelSaveBar, PersonnelTabSection, TabScrollShell } from './shared';

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
        <p className="flex items-center gap-2 text-fs-meta text-ink-4">
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
      <div data-personnel-tab-scroll className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex w-full flex-col gap-6 pb-32">
          <PersonnelTabSection title="Execution binding" className="py-0">
            <RuntimeBindingControl
              scope="employee"
              value={formData.runtimeBinding}
              onChange={handleChange}
              resolvedBinding={resolved.binding}
              resolvedSource={resolved.source}
            />
          </PersonnelTabSection>
          <PersonnelTabSection title="Tool permissions" className="py-0">
            <ToolPermissionEditor
              value={formData.toolPermissionPolicy}
              onChange={(value) => updateField('toolPermissionPolicy', value)}
            />
          </PersonnelTabSection>
        </div>
      </div>

      {isDirty && (
        <PersonnelSaveBar className="bg-surface-1 px-6">
          <div className="flex flex-1 items-center justify-end gap-3">
            <Button size="sm" disabled={isSaving} onClick={save}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </PersonnelSaveBar>
      )}
    </div>
  );
}
