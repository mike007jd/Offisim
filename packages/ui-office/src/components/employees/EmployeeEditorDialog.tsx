import { computeFloorPlan } from '@offisim/renderer';
import type { RoleSlug } from '@offisim/shared-types';
import { extractZoneSlug } from '@offisim/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@offisim/ui-core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import type { UseEmployeeEditorReturn } from '../../hooks/useEmployeeEditor';
import { buildSystemPrompt } from '../../lib/build-system-prompt';
import { ROLE_OPTIONS } from '../../lib/roles';
import { useCompany } from '../company/CompanyContext.js';
import { AvatarCustomizer } from './AvatarCustomizer';
import { MemoryPanel } from './MemoryPanel';
import { SkillBindingList } from './SkillBindingList';
import { ToolPermissionEditor } from './ToolPermissionEditor';
import { VersionHistoryTab } from './VersionHistoryTab';

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

interface ProviderOption {
  value: string;
  label: string;
  models: string[];
  /** Vendor-direct model groups — hidden in production builds. */
  devOnly?: boolean;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'default',
    label: 'Default (use company setting)',
    models: [],
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
  {
    value: 'custom',
    label: 'Custom',
    models: [],
  },
];

const VISIBLE_PROVIDER_OPTIONS = import.meta.env.DEV
  ? PROVIDER_OPTIONS
  : PROVIDER_OPTIONS.filter((o) => !o.devOnly);

/** Derive the provider from a model preference string (best-effort). */
function inferProvider(modelPref: string): string {
  if (!modelPref) return 'default';
  const m = modelPref.toLowerCase();
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  return 'custom';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EmployeeEditorDialogProps extends UseEmployeeEditorReturn {}

export function EmployeeEditorDialog({
  isOpen,
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
  close,
  sourceAssetId,
  sourcePackageId,
}: EmployeeEditorDialogProps) {
  const { activeCompanyId } = useCompany();
  const { zones: companyZones } = useCompanyZones();
  const isEditMode = employeeId !== null;
  const title = isEditMode ? `Edit Employee: ${formData.name || 'Unnamed'}` : 'New Employee';
  const canSave = isDirty && formData.name.trim() !== '' && !isSaving;

  // System prompt preview state
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // Provider selector state (derived from modelPreference, not persisted separately)
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

    if (validZones.length === 0) {
      return [];
    }

    const plan = computeFloorPlan(validZones, new Map());
    const zoneLabels = new Map<string, string>();
    for (const zone of validZones) {
      zoneLabels.set(zone.zoneId, zone.label);
      const slug = extractZoneSlug(zone.zoneId);
      if (slug) {
        zoneLabels.set(slug, zone.label);
      }
    }

    const labelCounts = new Map<string, number>();
    const options: Array<{ value: string; label: string }> = [];

    for (const [workstationId, desk] of plan.allWorkstations.entries()) {
      const zoneLabel = zoneLabels.get(desk.zoneId) ?? 'Workspace';
      const nextIndex = (labelCounts.get(zoneLabel) ?? 0) + 1;
      labelCounts.set(zoneLabel, nextIndex);
      options.push({
        value: workstationId,
        label: `${zoneLabel} · Desk ${nextIndex}`,
      });
    }

    return options;
  }, [companyZones]);

  // Workstation tools badge
  const workstationLabel = formData.workstation_id
    ? (workstationOptions.find((w) => w.value === formData.workstation_id)?.label ?? 'Assigned')
    : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="profile" className="mt-2 flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="profile" className="flex-1">
              Profile
            </TabsTrigger>
            <TabsTrigger value="persona" className="flex-1">
              Persona
            </TabsTrigger>
            <TabsTrigger value="config" className="flex-1">
              Config
            </TabsTrigger>
            {isEditMode && (
              <TabsTrigger value="memory" className="flex-1">
                Memory
              </TabsTrigger>
            )}
            {isEditMode && (
              <TabsTrigger value="history" className="flex-1">
                History
              </TabsTrigger>
            )}
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="editor-name" className="text-sm text-slate-400 mb-1 block">
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
                <label htmlFor="editor-role" className="text-sm text-slate-400 mb-1 block">
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
                <label htmlFor="editor-enabled" className="text-sm text-slate-400 mb-1 block">
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

              {/* Workstation assignment with tools badge */}
              <div>
                <label htmlFor="editor-workstation" className="text-sm text-slate-400 mb-1 block">
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
                {/* Associated tools indicator */}
                <p className="text-[10px] text-slate-500 mt-1">
                  {workstationLabel
                    ? `${workstationLabel} — MCP tools available via workstation rack`
                    : 'No workstation assigned — no MCP tools accessible'}
                </p>
              </div>

              {formData.isExternal ? (
                <div
                  data-testid="external-avatar-disabled"
                  className="flex flex-col gap-1 p-3 rounded-xl border border-white/10 bg-white/5"
                >
                  <p className="text-[10px] font-medium text-slate-300 uppercase tracking-wider">
                    Appearance
                  </p>
                  <p className="text-xs text-slate-400">
                    This employee uses its brand's built-in avatar and cannot be customized.
                  </p>
                </div>
              ) : (
                <AvatarCustomizer
                  config={formData.appearance}
                  onChange={(cfg) => updateField('appearance', cfg)}
                />
              )}
            </div>
          </TabsContent>

          {/* Persona Tab */}
          <TabsContent value="persona" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              <div>
                <label htmlFor="editor-expertise" className="text-sm text-slate-400 mb-1 block">
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
                <label htmlFor="editor-style" className="text-sm text-slate-400 mb-1 block">
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
                <p className="text-sm text-slate-400 mb-2 block">Communication Frequency</p>
                <div className="flex gap-2">
                  {['low', 'medium', 'high'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        updateField(
                          'communicationFrequency',
                          value as typeof formData.communicationFrequency,
                        )
                      }
                      className={`rounded-md border px-3 py-1.5 text-xs transition ${
                        formData.communicationFrequency === value
                          ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-400 mb-2 block">Risk Preference</p>
                <div className="flex gap-2">
                  {['conservative', 'balanced', 'aggressive'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        updateField('riskPreference', value as typeof formData.riskPreference)
                      }
                      className={`rounded-md border px-3 py-1.5 text-xs transition ${
                        formData.riskPreference === value
                          ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="editor-decision-style"
                  className="text-sm text-slate-400 mb-1 block"
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
                <label htmlFor="editor-instructions" className="text-sm text-slate-400 mb-1 block">
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

              {/* System Prompt Preview — collapsible */}
              <div className="border border-slate-700 rounded">
                <button
                  type="button"
                  onClick={() => setShowSystemPrompt((v) => !v)}
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showSystemPrompt ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  System Prompt Preview
                </button>
                {showSystemPrompt && (
                  <pre className="px-3 pb-3 text-[11px] font-mono text-slate-300 bg-black/20 whitespace-pre-wrap leading-relaxed overflow-x-hidden">
                    {buildSystemPrompt(formData)}
                  </pre>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col gap-4 pt-2">
              {/* Provider selector */}
              <div>
                <label htmlFor="editor-provider" className="text-sm text-slate-400 mb-1 block">
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

              {/* Model preference — with datalist suggestions per provider */}
              <div>
                <label htmlFor="editor-model" className="text-sm text-slate-400 mb-1 block">
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
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {currentProviderModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateField('modelPreference', m)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800/50 text-slate-400 hover:border-blue-500 hover:text-blue-300 transition-colors"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="editor-temperature" className="text-sm text-slate-400 mb-1 block">
                  Temperature
                </label>
                <Input
                  id="editor-temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={formData.temperature}
                  onChange={(e) =>
                    updateField('temperature', Number.parseFloat(e.target.value) || 0)
                  }
                />
              </div>

              <div>
                <label htmlFor="editor-max-tokens" className="text-sm text-slate-400 mb-1 block">
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
                  <p className="mt-1 text-[10px] text-amber-400">
                    Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
                  </p>
                )}
              </div>

              {/* Skills */}
              {isEditMode && employeeId && (
                <div>
                  <p className="text-sm text-slate-400 mb-2 block">Skills</p>
                  <SkillBindingList companyId={activeCompanyId} employeeId={employeeId} />
                </div>
              )}

              <div>
                <p className="text-sm text-slate-400 mb-2 block">Tool Permissions</p>
                <ToolPermissionEditor
                  value={formData.toolPermissionPolicy}
                  onChange={(value) => updateField('toolPermissionPolicy', value)}
                />
              </div>
            </div>
          </TabsContent>

          {isEditMode && employeeId && activeCompanyId && (
            <TabsContent value="memory" className="flex-1 overflow-y-auto min-h-0">
              <MemoryPanel employeeId={employeeId} companyId={activeCompanyId} />
            </TabsContent>
          )}

          {/* History Tab (edit mode only) */}
          {isEditMode && employeeId && (
            <TabsContent value="history" className="flex-1 overflow-y-auto min-h-0">
              <VersionHistoryTab
                employeeId={employeeId}
                forkOrigin={
                  sourceAssetId
                    ? {
                        sourceAssetId,
                        sourcePackageId: sourcePackageId ?? null,
                      }
                    : null
                }
              />
            </TabsContent>
          )}
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-2">
          <div>
            {isEditMode && !isConfirmingDelete && (
              <Button variant="destructive" size="sm" disabled={isSaving} onClick={requestDelete}>
                Delete
              </Button>
            )}
            {isEditMode && isConfirmingDelete && (
              <div className="flex items-center gap-2">
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
            {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSave} onClick={save}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
