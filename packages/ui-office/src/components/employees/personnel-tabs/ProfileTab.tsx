import { computeFloorPlan } from '@offisim/renderer';
import type { RoleSlug } from '@offisim/shared-types';
import { extractZoneSlug } from '@offisim/shared-types';
import {
  Badge,
  Button,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCompanyZones } from '../../../hooks/useCompanyZones.js';
import type { UseEmployeeEditorReturn } from '../../../hooks/useEmployeeEditor';
import { lookupExternalBrand } from '../../../lib/brand-registry';
import { buildSystemPrompt } from '../../../lib/build-system-prompt';
import { ROLE_OPTIONS } from '../../../lib/roles';
import { useCompany } from '../../company/CompanyContext.js';
import { SkillBindingList } from '../SkillBindingList';
import {
  PersonnelField,
  PersonnelReadOnlyField,
  PersonnelSaveBar,
  PersonnelTabSection,
} from './shared';

interface ProviderOption {
  value: string;
  label: string;
  models: string[];
  devOnly?: boolean;
}

const EMPLOYEE_MODEL_SUGGESTIONS = ['MiniMax-M2.7', 'GLM-5.1', 'openai/gpt-oss-120b:free'] as const;

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'configured',
    label: 'Configured validation models',
    models: [...EMPLOYEE_MODEL_SUGGESTIONS],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    devOnly: true,
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest'],
    devOnly: true,
  },
  {
    value: 'google',
    label: 'Google',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    devOnly: true,
  },
  {
    value: 'ollama',
    label: 'Ollama (local)',
    models: ['llama3.2', 'mistral', 'phi3', 'gemma2'],
    devOnly: true,
  },
  { value: 'custom', label: 'Custom', models: [] },
];

const VISIBLE_PROVIDER_OPTIONS = import.meta.env.DEV
  ? PROVIDER_OPTIONS
  : PROVIDER_OPTIONS.filter((o) => !o.devOnly);

function inferProvider(modelPref: string): string {
  if (!modelPref) return 'configured';
  if (EMPLOYEE_MODEL_SUGGESTIONS.includes(modelPref as (typeof EMPLOYEE_MODEL_SUGGESTIONS)[number]))
    return 'configured';
  const m = modelPref.toLowerCase();
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  return 'custom';
}

interface ProfileTabProps {
  editor: UseEmployeeEditorReturn;
}

export function ProfileTab({ editor }: ProfileTabProps) {
  const {
    employeeId,
    formData,
    isDirty,
    isSaving,
    isConfirmingDelete,
    deleteError,
    updateField,
    save,
    requestDelete,
    cancelDelete,
    confirmDelete,
  } = editor;

  const { activeCompanyId } = useCompany();
  const { zones: companyZones } = useCompanyZones();
  const isEditMode = employeeId !== null;
  const canSave = !formData.isExternal && isDirty && formData.name.trim() !== '' && !isSaving;
  const modelMode = formData.modelPreference.trim() ? 'custom' : 'inherit';

  const [promptPreviewOpenByEmployee, setPromptPreviewOpenByEmployee] = useState<
    Record<string, boolean>
  >({});
  const [selectedProvider, setSelectedProvider] = useState(() =>
    inferProvider(formData.modelPreference),
  );

  useEffect(() => {
    setSelectedProvider(inferProvider(formData.modelPreference));
  }, [formData.modelPreference]);

  const handleModelModeChange = (mode: string) => {
    if (mode === 'inherit') {
      updateField('modelPreference', '');
      return;
    }
    if (!formData.modelPreference.trim()) {
      updateField('modelPreference', EMPLOYEE_MODEL_SUGGESTIONS[0]);
    }
    setSelectedProvider(inferProvider(formData.modelPreference));
  };

  const currentProviderModels =
    PROVIDER_OPTIONS.find((p) => p.value === selectedProvider)?.models ?? [];

  const workstationOptions = useMemo(() => {
    const validZones = companyZones.filter(
      (zone): zone is (typeof companyZones)[number] & { zoneId: string } =>
        typeof zone.zoneId === 'string' && zone.zoneId.trim() !== '',
    );
    if (validZones.length === 0) return [];
    const plan = computeFloorPlan(validZones, new Map());
    const zoneLabels = new Map<string, string>();
    for (const zone of validZones) {
      zoneLabels.set(zone.zoneId, zone.label);
      const slug = extractZoneSlug(zone.zoneId);
      if (slug) zoneLabels.set(slug, zone.label);
    }
    const labelCounts = new Map<string, number>();
    const options: Array<{ value: string; label: string }> = [];
    for (const [workstationId, desk] of plan.allWorkstations.entries()) {
      const zoneLabel = zoneLabels.get(desk.zoneId) ?? 'Workspace';
      const nextIndex = (labelCounts.get(zoneLabel) ?? 0) + 1;
      labelCounts.set(zoneLabel, nextIndex);
      options.push({ value: workstationId, label: `${zoneLabel} · Desk ${nextIndex}` });
    }
    return options;
  }, [companyZones]);

  const workstationLabel = formData.workstation_id
    ? (workstationOptions.find((w) => w.value === formData.workstation_id)?.label ?? 'Assigned')
    : null;
  const promptPreviewKey = employeeId ?? 'new-employee';
  const showSystemPrompt = promptPreviewOpenByEmployee[promptPreviewKey] ?? false;
  const toggleSystemPrompt = () => {
    setPromptPreviewOpenByEmployee((prev) => ({
      ...prev,
      [promptPreviewKey]: !(prev[promptPreviewKey] ?? false),
    }));
  };

  if (formData.isExternal) {
    const brand = lookupExternalBrand(formData.brandKey);
    const roleLabel = ROLE_OPTIONS.find((role) => role.value === formData.role_slug)?.label;
    return (
      <div className="personnel-profile-tab">
        <div data-personnel-tab-scroll className="personnel-profile-scroll">
          <div className="personnel-profile-stack" data-compact>
            <div className="personnel-brand-managed">
              <div>
                <div>
                  <p>Brand-managed employee</p>
                  <p>
                    Profile, runtime, and permissions are controlled by the external A2A endpoint.
                  </p>
                </div>
                <Badge variant="outline" size="xs" className="personnel-brand-badge">
                  {brand.displayName}
                </Badge>
              </div>
            </div>

            <PersonnelTabSection title="Identity">
              <PersonnelReadOnlyField label="Name" value={formData.name || 'Unnamed employee'} />
              <PersonnelReadOnlyField label="Role" value={roleLabel ?? formData.role_slug} />
              <PersonnelReadOnlyField
                label="Status"
                value={formData.enabled ? 'Enabled' : 'Disabled'}
              />
              <PersonnelReadOnlyField label="Brand" value={brand.displayName} />
              <PersonnelReadOnlyField
                label="Workstation"
                value={workstationLabel ?? 'Unassigned'}
              />
            </PersonnelTabSection>

            <PersonnelTabSection title="Persona">
              <PersonnelReadOnlyField
                label="Expertise"
                value={formData.expertise || 'Managed externally'}
              />
              <PersonnelReadOnlyField
                label="Working Style"
                value={formData.style || 'Managed externally'}
              />
              <PersonnelReadOnlyField
                label="Instructions"
                value={formData.customInstructions || 'Managed externally'}
              />
            </PersonnelTabSection>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="personnel-profile-tab">
      <div data-personnel-tab-scroll className="personnel-profile-scroll">
        <div className="personnel-profile-stack">
          <PersonnelTabSection title="Identity">
            <PersonnelField label="Name" htmlFor="editor-name">
              <Input
                id="editor-name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Employee name"
              />
            </PersonnelField>
            <PersonnelField label="Role" htmlFor="editor-role">
              <Select
                value={formData.role_slug}
                onValueChange={(v) => updateField('role_slug', v as RoleSlug)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PersonnelField>
            <PersonnelField label="Status" htmlFor="editor-enabled">
              <Button
                id="editor-enabled"
                type="button"
                variant={formData.enabled ? 'default' : 'secondary'}
                size="sm"
                onClick={() => updateField('enabled', !formData.enabled)}
              >
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </Button>
            </PersonnelField>
            <PersonnelField
              label="Assign Workstation"
              htmlFor="editor-workstation"
              note={
                <span
                  title={
                    workstationLabel
                      ? 'MCP tools available via workstation rack.'
                      : 'No MCP tools accessible without a workstation.'
                  }
                >
                  {workstationLabel ? 'MCP tools enabled' : 'No MCP tools'}
                </span>
              }
            >
              <Select
                value={formData.workstation_id ?? 'none'}
                onValueChange={(v) => updateField('workstation_id', v === 'none' ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {workstationOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PersonnelField>
          </PersonnelTabSection>

          <PersonnelTabSection title="Persona">
            <PersonnelField label="Expertise" htmlFor="editor-expertise">
              <Textarea
                id="editor-expertise"
                value={formData.expertise}
                onChange={(e) => updateField('expertise', e.target.value)}
                placeholder="e.g. full-stack development, React, Node.js"
                rows={3}
              />
            </PersonnelField>
            <PersonnelField label="Working Style" htmlFor="editor-style">
              <Textarea
                id="editor-style"
                value={formData.style}
                onChange={(e) => updateField('style', e.target.value)}
                placeholder="e.g. detail-oriented, collaborative"
                rows={3}
              />
            </PersonnelField>
            <PersonnelField label="Communication Frequency">
              <SegmentedControl
                size="sm"
                ariaLabel="Communication frequency"
                value={formData.communicationFrequency}
                onChange={(value) => updateField('communicationFrequency', value)}
                items={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </PersonnelField>
            <PersonnelField label="Risk Preference">
              <SegmentedControl
                size="sm"
                ariaLabel="Risk preference"
                value={formData.riskPreference}
                onChange={(value) => updateField('riskPreference', value)}
                items={[
                  { value: 'conservative', label: 'Conservative' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'aggressive', label: 'Aggressive' },
                ]}
              />
            </PersonnelField>
            <PersonnelField label="Decision Style" htmlFor="editor-decision-style">
              <Select
                value={formData.decisionStyle}
                onValueChange={(value) =>
                  updateField('decisionStyle', value as typeof formData.decisionStyle)
                }
              >
                <SelectTrigger id="editor-decision-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analytical">Analytical</SelectItem>
                  <SelectItem value="intuitive">Intuitive</SelectItem>
                  <SelectItem value="collaborative">Collaborative</SelectItem>
                  <SelectItem value="directive">Directive</SelectItem>
                </SelectContent>
              </Select>
            </PersonnelField>
            <PersonnelField label="Custom Instructions" htmlFor="editor-instructions">
              <Textarea
                id="editor-instructions"
                value={formData.customInstructions}
                onChange={(e) => updateField('customInstructions', e.target.value)}
                placeholder="Additional instructions for this employee's behavior..."
                rows={4}
              />
            </PersonnelField>
            <div className="personnel-system-prompt">
              <Button
                type="button"
                variant="ghost"
                onClick={toggleSystemPrompt}
                className="personnel-system-prompt-toggle"
              >
                {showSystemPrompt ? (
                  <ChevronDown data-icon="prompt-toggle" aria-hidden="true" />
                ) : (
                  <ChevronRight data-icon="prompt-toggle" aria-hidden="true" />
                )}
                System Prompt Preview
              </Button>
              {showSystemPrompt && <pre>{buildSystemPrompt(formData)}</pre>}
            </div>
          </PersonnelTabSection>

          <PersonnelTabSection title="Config">
            <PersonnelField label="Model mode">
              <SegmentedControl
                size="sm"
                ariaLabel="Employee model mode"
                value={modelMode}
                onChange={handleModelModeChange}
                items={[
                  { value: 'inherit', label: 'Inherit unified setting' },
                  { value: 'custom', label: 'Custom model' },
                ]}
              />
              <p className="personnel-model-note">
                {modelMode === 'inherit'
                  ? 'Uses the company-wide model from Settings > Provider.'
                  : 'This employee will use the explicit model below.'}
              </p>
            </PersonnelField>
            {modelMode === 'custom' ? (
              <>
                <PersonnelField label="Model family" htmlFor="editor-provider">
                  <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger id="editor-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIBLE_PROVIDER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PersonnelField>
                <PersonnelField label="Override model" htmlFor="editor-model">
                  <Input
                    id="editor-model"
                    list="editor-model-suggestions"
                    value={formData.modelPreference}
                    onChange={(e) => updateField('modelPreference', e.target.value)}
                    placeholder="e.g. MiniMax-M2.7, GLM-5.1, openai/gpt-oss-120b:free"
                  />
                  {currentProviderModels.length > 0 && (
                    <datalist id="editor-model-suggestions">
                      {currentProviderModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                  {currentProviderModels.length > 0 && (
                    <div className="personnel-model-suggestions">
                      {currentProviderModels.map((m) => (
                        <Button
                          key={m}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => updateField('modelPreference', m)}
                          className="personnel-model-chip"
                        >
                          {m}
                        </Button>
                      ))}
                    </div>
                  )}
                </PersonnelField>
              </>
            ) : null}
            <PersonnelField label="Temperature" htmlFor="editor-temperature">
              <Input
                id="editor-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={formData.temperature}
                onChange={(e) => updateField('temperature', Number.parseFloat(e.target.value) || 0)}
              />
            </PersonnelField>
            <PersonnelField label="Max Tokens" htmlFor="editor-max-tokens">
              <Input
                id="editor-max-tokens"
                type="number"
                min={1}
                max={100000}
                step={1}
                value={formData.maxTokens}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  updateField('maxTokens', Number.isFinite(n) && n > 0 ? n : 4096);
                }}
              />
              {formData.maxTokens < 1024 && (
                <p className="personnel-token-warning">
                  Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
                </p>
              )}
            </PersonnelField>
          </PersonnelTabSection>

          {isEditMode && employeeId && (
            <PersonnelTabSection title="Skills">
              <SkillBindingList companyId={activeCompanyId} employeeId={employeeId} />
            </PersonnelTabSection>
          )}
        </div>
      </div>

      {/* Sticky save bar */}
      <PersonnelSaveBar>
        <div className="personnel-save-left">
          {isEditMode && !isConfirmingDelete && (
            <Button variant="destructive" size="sm" disabled={isSaving} onClick={requestDelete}>
              Delete
            </Button>
          )}
          {isEditMode && isConfirmingDelete && (
            <div className="personnel-delete-confirm">
              <span>Delete {formData.name || 'this employee'}? This cannot be undone.</span>
              <Button variant="destructive" size="sm" disabled={isSaving} onClick={confirmDelete}>
                {isSaving ? 'Deleting...' : 'Delete'}
              </Button>
              <Button variant="outline" size="sm" onClick={cancelDelete}>
                Cancel
              </Button>
            </div>
          )}
          {deleteError && <p className="personnel-delete-error">{deleteError}</p>}
        </div>
        <Button size="sm" disabled={!canSave} onClick={save}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </PersonnelSaveBar>
    </div>
  );
}
