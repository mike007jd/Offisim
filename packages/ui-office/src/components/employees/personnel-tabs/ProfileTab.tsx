import { computeFloorPlan } from '@offisim/renderer';
import type { RoleSlug } from '@offisim/shared-types';
import { extractZoneSlug } from '@offisim/shared-types';
import {
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
import { buildSystemPrompt } from '../../../lib/build-system-prompt';
import { ROLE_OPTIONS } from '../../../lib/roles';
import { useCompany } from '../../company/CompanyContext.js';
import { SkillBindingList } from '../SkillBindingList';
import { ToolPermissionEditor } from '../ToolPermissionEditor';

interface ProviderOption {
  value: string;
  label: string;
  models: string[];
  devOnly?: boolean;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: 'default', label: 'Default (use company setting)', models: [] },
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
  if (!modelPref) return 'default';
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
  const canSave = isDirty && formData.name.trim() !== '' && !isSaving;

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(() =>
    inferProvider(formData.modelPreference),
  );

  useEffect(() => {
    setSelectedProvider(inferProvider(formData.modelPreference));
  }, [formData.modelPreference]);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    if (provider === 'default') {
      updateField('modelPreference', '');
    }
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 pb-32 lg:grid-cols-2">
          {/* Identity */}
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Identity
            </h3>
            <div>
              <label htmlFor="editor-name" className="mb-1 block text-sm text-text-secondary">
                Name
              </label>
              <Input
                id="editor-name"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Employee name"
              />
            </div>
            <div>
              <label htmlFor="editor-role" className="mb-1 block text-sm text-text-secondary">
                Role
              </label>
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
            </div>
            <div>
              <label htmlFor="editor-enabled" className="mb-1 block text-sm text-text-secondary">
                Status
              </label>
              <Button
                id="editor-enabled"
                type="button"
                variant={formData.enabled ? 'default' : 'secondary'}
                size="sm"
                onClick={() => updateField('enabled', !formData.enabled)}
              >
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
            <div>
              <label
                htmlFor="editor-workstation"
                className="mb-1 block text-sm text-text-secondary"
              >
                Assign Workstation
              </label>
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
                className="mt-1 text-[10px] text-text-muted"
                title={
                  workstationLabel
                    ? 'MCP tools available via workstation rack.'
                    : 'No MCP tools accessible without a workstation.'
                }
              >
                {workstationLabel ? 'MCP tools enabled' : 'No MCP tools'}
              </p>
            </div>
          </section>

          {/* Persona */}
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Persona
            </h3>
            <div>
              <label htmlFor="editor-expertise" className="mb-1 block text-sm text-text-secondary">
                Expertise
              </label>
              <Textarea
                id="editor-expertise"
                value={formData.expertise}
                onChange={(e) => updateField('expertise', e.target.value)}
                placeholder="e.g. full-stack development, React, Node.js"
                rows={3}
              />
            </div>
            <div>
              <label htmlFor="editor-style" className="mb-1 block text-sm text-text-secondary">
                Working Style
              </label>
              <Textarea
                id="editor-style"
                value={formData.style}
                onChange={(e) => updateField('style', e.target.value)}
                placeholder="e.g. detail-oriented, collaborative"
                rows={3}
              />
            </div>
            <div>
              <p className="mb-2 block text-sm text-text-secondary">Communication Frequency</p>
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
            </div>
            <div>
              <p className="mb-2 block text-sm text-text-secondary">Risk Preference</p>
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
            </div>
            <div>
              <label
                htmlFor="editor-decision-style"
                className="mb-1 block text-sm text-text-secondary"
              >
                Decision Style
              </label>
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
            </div>
            <div>
              <label
                htmlFor="editor-instructions"
                className="mb-1 block text-sm text-text-secondary"
              >
                Custom Instructions
              </label>
              <Textarea
                id="editor-instructions"
                value={formData.customInstructions}
                onChange={(e) => updateField('customInstructions', e.target.value)}
                placeholder="Additional instructions for this employee's behavior..."
                rows={4}
              />
            </div>
            <div className="rounded-lg border border-border-default bg-surface-muted">
              <button
                type="button"
                onClick={() => setShowSystemPrompt((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                {showSystemPrompt ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                System Prompt Preview
              </button>
              {showSystemPrompt && (
                <pre className="overflow-x-hidden whitespace-pre-wrap bg-surface px-3 pb-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                  {buildSystemPrompt(formData)}
                </pre>
              )}
            </div>
          </section>

          {/* Config */}
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Config
            </h3>
            <div>
              <label htmlFor="editor-provider" className="mb-1 block text-sm text-text-secondary">
                Provider
              </label>
              <Select value={selectedProvider} onValueChange={handleProviderChange}>
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
            </div>
            <div>
              <label htmlFor="editor-model" className="mb-1 block text-sm text-text-secondary">
                Model
              </label>
              <Input
                id="editor-model"
                list="editor-model-suggestions"
                value={formData.modelPreference}
                onChange={(e) => updateField('modelPreference', e.target.value)}
                placeholder={
                  selectedProvider === 'default'
                    ? 'Using company default'
                    : 'e.g. gpt-4o, claude-opus-4-5'
                }
                disabled={selectedProvider === 'default'}
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
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateField('modelPreference', m)}
                      className="rounded border border-border-default bg-surface-muted px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-border-focus hover:text-accent-text"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="editor-temperature"
                className="mb-1 block text-sm text-text-secondary"
              >
                Temperature
              </label>
              <Input
                id="editor-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={formData.temperature}
                onChange={(e) => updateField('temperature', Number.parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label htmlFor="editor-max-tokens" className="mb-1 block text-sm text-text-secondary">
                Max Tokens
              </label>
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
                <p className="mt-1 text-[10px] text-warning">
                  Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
                </p>
              )}
            </div>
            {isEditMode && employeeId && (
              <div>
                <p className="mb-2 block text-sm text-text-secondary">Skills</p>
                <SkillBindingList companyId={activeCompanyId} employeeId={employeeId} />
              </div>
            )}
            <div>
              <p className="mb-2 block text-sm text-text-secondary">Tool Permissions</p>
              <ToolPermissionEditor
                value={formData.toolPermissionPolicy}
                onChange={(value) => updateField('toolPermissionPolicy', value)}
              />
            </div>
          </section>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="shrink-0 border-t border-border-default bg-surface-elevated px-6 py-3 backdrop-blur-sm">
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
