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
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useCompanyZones } from '../../../hooks/useCompanyZones.js';
import type { UseEmployeeEditorReturn } from '../../../hooks/useEmployeeEditor';
import { buildSystemPrompt } from '../../../lib/build-system-prompt';
import { lookupExternalBrand } from '../../../lib/brand-registry';
import { ROLE_OPTIONS } from '../../../lib/roles';
import { useCompany } from '../../company/CompanyContext.js';
import { SkillBindingList } from '../SkillBindingList';

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

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
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

  if (formData.isExternal) {
    const brand = lookupExternalBrand(formData.brandKey);
    const roleLabel = ROLE_OPTIONS.find((role) => role.value === formData.role_slug)?.label;
    return (
      <div className="flex h-full flex-col bg-surface-elevated">
        <div data-personnel-tab-scroll className="flex-1 overflow-y-auto px-sp-5">
          <div className="flex w-full flex-col pb-10">
            <div className="mt-sp-5 rounded-md border border-line-soft bg-surface-sunken px-sp-4 py-sp-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-fs-sm font-semibold text-ink-1">Brand-managed employee</p>
                  <p className="mt-1 text-caption text-ink-3">
                    Profile, runtime, and permissions are controlled by the external A2A endpoint.
                  </p>
                </div>
                <Badge variant="outline" size="xs" className="shrink-0">
                  {brand.displayName}
                </Badge>
              </div>
            </div>

            <ProfileSection title="Identity">
              <ReadOnlyField label="Name" value={formData.name || 'Unnamed employee'} />
              <ReadOnlyField label="Role" value={roleLabel ?? formData.role_slug} />
              <ReadOnlyField label="Status" value={formData.enabled ? 'Enabled' : 'Disabled'} />
              <ReadOnlyField label="Brand" value={brand.displayName} />
              <ReadOnlyField label="Workstation" value={workstationLabel ?? 'Unassigned'} />
            </ProfileSection>

            <ProfileSection title="Persona">
              <ReadOnlyField label="Expertise" value={formData.expertise || 'Managed externally'} />
              <ReadOnlyField label="Working Style" value={formData.style || 'Managed externally'} />
              <ReadOnlyField
                label="Instructions"
                value={formData.customInstructions || 'Managed externally'}
              />
            </ProfileSection>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-elevated">
      <div data-personnel-tab-scroll className="flex-1 overflow-y-auto px-sp-5">
        <div className="flex w-full flex-col pb-32">
          <ProfileSection title="Identity">
            <FieldStack>
              <FieldLabel htmlFor="editor-name">Name</FieldLabel>
              <Input
                id="editor-name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Employee name"
              />
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-role">Role</FieldLabel>
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
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-enabled">Status</FieldLabel>
              <Button
                id="editor-enabled"
                type="button"
                variant={formData.enabled ? 'default' : 'secondary'}
                size="sm"
                onClick={() => updateField('enabled', !formData.enabled)}
              >
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </Button>
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-workstation">Assign Workstation</FieldLabel>
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
              <p
                className="mt-1 text-caption text-text-muted"
                title={
                  workstationLabel
                    ? 'MCP tools available via workstation rack.'
                    : 'No MCP tools accessible without a workstation.'
                }
              >
                {workstationLabel ? 'MCP tools enabled' : 'No MCP tools'}
              </p>
            </FieldStack>
          </ProfileSection>

          <ProfileSection title="Persona">
            <FieldStack>
              <FieldLabel htmlFor="editor-expertise">Expertise</FieldLabel>
              <Textarea
                id="editor-expertise"
                value={formData.expertise}
                onChange={(e) => updateField('expertise', e.target.value)}
                placeholder="e.g. full-stack development, React, Node.js"
                rows={3}
              />
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-style">Working Style</FieldLabel>
              <Textarea
                id="editor-style"
                value={formData.style}
                onChange={(e) => updateField('style', e.target.value)}
                placeholder="e.g. detail-oriented, collaborative"
                rows={3}
              />
            </FieldStack>
            <FieldStack>
              <FieldLabel>Communication Frequency</FieldLabel>
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
            </FieldStack>
            <FieldStack>
              <FieldLabel>Risk Preference</FieldLabel>
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
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-decision-style">Decision Style</FieldLabel>
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
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-instructions">Custom Instructions</FieldLabel>
              <Textarea
                id="editor-instructions"
                value={formData.customInstructions}
                onChange={(e) => updateField('customInstructions', e.target.value)}
                placeholder="Additional instructions for this employee's behavior..."
                rows={4}
              />
            </FieldStack>
            <div className="rounded-md border border-line-soft bg-surface-sunken">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowSystemPrompt((v) => !v)}
                className="h-auto w-full justify-start gap-1.5 rounded-md px-3 py-2 text-fs-sm text-ink-3 hover:text-ink-1"
              >
                {showSystemPrompt ? (
                  <ChevronDown className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" />
                )}
                System Prompt Preview
              </Button>
              {showSystemPrompt && (
                <pre className="overflow-x-hidden whitespace-pre-wrap border-t border-line-soft bg-surface-1 px-3 pb-3 pt-3 font-mono text-caption leading-relaxed text-text-secondary">
                  {buildSystemPrompt(formData)}
                </pre>
              )}
            </div>
          </ProfileSection>

          <ProfileSection title="Config">
            <FieldStack>
              <FieldLabel>Model mode</FieldLabel>
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
              <p className="mt-2 text-xs text-text-muted">
                {modelMode === 'inherit'
                  ? 'Uses the company-wide model from Settings > Provider.'
                  : 'This employee will use the explicit model below.'}
              </p>
            </FieldStack>
            {modelMode === 'custom' ? (
              <>
                <FieldStack>
                  <FieldLabel htmlFor="editor-provider">Model family</FieldLabel>
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
                </FieldStack>
                <FieldStack>
                  <FieldLabel htmlFor="editor-model">Override model</FieldLabel>
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
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {currentProviderModels.map((m) => (
                        <Button
                          key={m}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => updateField('modelPreference', m)}
                          className="h-6 rounded-xs px-1.5 py-0.5 text-caption text-text-secondary hover:border-border-focus hover:text-accent-text"
                        >
                          {m}
                        </Button>
                      ))}
                    </div>
                  )}
                </FieldStack>
              </>
            ) : null}
            <FieldStack>
              <FieldLabel htmlFor="editor-temperature">Temperature</FieldLabel>
              <Input
                id="editor-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={formData.temperature}
                onChange={(e) => updateField('temperature', Number.parseFloat(e.target.value) || 0)}
              />
            </FieldStack>
            <FieldStack>
              <FieldLabel htmlFor="editor-max-tokens">Max Tokens</FieldLabel>
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
                <p className="mt-1 text-caption text-warning">
                  Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
                </p>
              )}
            </FieldStack>
          </ProfileSection>

          {isEditMode && employeeId && (
            <ProfileSection title="Skills">
              <SkillBindingList companyId={activeCompanyId} employeeId={employeeId} />
            </ProfileSection>
          )}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="shrink-0 border-t border-line-soft bg-surface-1 px-sp-5 py-3 shadow-overlay">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2">
            {isEditMode && !isConfirmingDelete && (
              <Button variant="destructive" size="sm" disabled={isSaving} onClick={requestDelete}>
                Delete
              </Button>
            )}
            {isEditMode && isConfirmingDelete && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-destructive">
                  Delete {formData.name || 'this employee'}? This cannot be undone.
                </span>
                <Button variant="destructive" size="sm" disabled={isSaving} onClick={confirmDelete}>
                  {isSaving ? 'Deleting...' : 'Delete'}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelDelete}>
                  Cancel
                </Button>
              </div>
            )}
            {deleteError && <p className="ml-2 text-xs text-destructive">{deleteError}</p>}
          </div>
          <Button size="sm" disabled={!canSave} onClick={save}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line-soft py-sp-5">
      <header className="mb-sp-3">
        <h3 className="text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3">
          {title}
        </h3>
      </header>
      <div className="flex flex-col gap-sp-3">{children}</div>
    </section>
  );
}

function FieldStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  const className = 'text-fs-meta font-medium text-ink-2';
  if (!htmlFor) {
    return <span className={className}>{children}</span>;
  }
  return (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <FieldStack>
      <FieldLabel>{label}</FieldLabel>
      <div className="min-h-9 rounded-md border border-line-soft bg-surface-1 px-3 py-2 text-fs-sm text-ink-1">
        {value}
      </div>
    </FieldStack>
  );
}
