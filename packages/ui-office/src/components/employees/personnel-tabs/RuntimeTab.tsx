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
        <p className="personnel-runtime-external">
          <Lock data-icon="runtime-lock" aria-hidden="true" />
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
    <div className="personnel-runtime-tab">
      <div data-personnel-tab-scroll className="personnel-runtime-scroll">
        <div className="personnel-runtime-stack">
          <PersonnelTabSection title="Execution binding" className="personnel-tab-section-flush">
            <RuntimeBindingControl
              scope="employee"
              value={formData.runtimeBinding}
              onChange={handleChange}
              resolvedBinding={resolved.binding}
              resolvedSource={resolved.source}
            />
          </PersonnelTabSection>
          <PersonnelTabSection title="Tool permissions" className="personnel-tab-section-flush">
            <ToolPermissionEditor
              value={formData.toolPermissionPolicy}
              onChange={(value) => updateField('toolPermissionPolicy', value)}
            />
          </PersonnelTabSection>
        </div>
      </div>

      {isDirty && (
        <PersonnelSaveBar className="personnel-save-bar-surface">
          <div className="personnel-save-bar-end">
            <Button size="sm" disabled={isSaving} onClick={save}>
              <Save data-icon="save" aria-hidden="true" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </PersonnelSaveBar>
      )}
    </div>
  );
}
