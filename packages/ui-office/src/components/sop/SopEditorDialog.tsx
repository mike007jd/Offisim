import { SopService, generateId } from '@offisim/core/browser';
import type { RoleSlug, SopDefinition, SopStep } from '@offisim/shared-types';
import { Button, DialogShell, ToastBanner, useToasts } from '@offisim/ui-core';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { HIREABLE_ROLES } from '../../lib/roles';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';

interface StepDraft {
  step_id: string;
  label: string;
  role_slug: RoleSlug;
  instruction: string;
  dependencies: string[];
  output_key: string;
}

function makeEmptyStep(index: number): StepDraft {
  return {
    step_id: `step_${index + 1}`,
    label: '',
    role_slug: 'developer' as RoleSlug,
    instruction: '',
    dependencies: [],
    output_key: `output_${index + 1}`,
  };
}

interface SopEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function SopEditorDialog({ open, onOpenChange, onCreated }: SopEditorDialogProps) {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { toasts, addToast, dismissToast } = useToasts();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([makeEmptyStep(0)]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const sopService = useMemo(() => {
    if (!repos?.sopTemplates) return null;
    return new SopService(repos.sopTemplates, eventBus);
  }, [repos, eventBus]);

  const resetDraft = useCallback(() => {
    setName('');
    setDescription('');
    setSteps([makeEmptyStep(0)]);
    setErrors([]);
  }, []);

  const isDirty = useMemo(
    () =>
      name.trim().length > 0 ||
      description.trim().length > 0 ||
      steps.some(
        (step, index) =>
          step.label.trim().length > 0 ||
          step.instruction.trim().length > 0 ||
          step.role_slug !== 'developer' ||
          (index > 0 && step.dependencies.length > 0),
      ),
    [description, name, steps],
  );

  const discardAndClose = useCallback(() => {
    resetDraft();
    onOpenChange(false);
  }, [onOpenChange, resetDraft]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
  }, [addToast, discardAndClose, isDirty, onOpenChange]);

  const handleRequestClose = useCallback(() => {
    if (!isDirty) return undefined;
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
    return false;
  }, [addToast, discardAndClose, isDirty]);

  const updateStep = useCallback((index: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, makeEmptyStep(prev.length)]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      const removed = prev[index];
      if (!removed) return prev;
      return prev
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          dependencies: s.dependencies.filter((d) => d !== removed.step_id),
        }));
    });
  }, []);

  const validate = useCallback((): boolean => {
    if (!sopService) return false;
    if (!name.trim()) {
      setErrors(['SOP name is required']);
      return false;
    }
    const definition: SopDefinition = {
      sop_id: 'draft',
      name: name.trim(),
      description: description.trim(),
      steps: steps as SopStep[],
      created_at: new Date().toISOString(),
    };
    const result = sopService.validateDefinition(definition);
    setErrors(result.errors);
    return result.valid;
  }, [sopService, name, description, steps]);

  const handleSave = useCallback(async () => {
    if (!repos?.sopTemplates || !activeCompanyId) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const sopId = generateId('sop');
      const definition: SopDefinition = {
        sop_id: sopId,
        name: name.trim(),
        description: description.trim(),
        steps: steps as SopStep[],
        created_at: new Date().toISOString(),
      };
      await repos.sopTemplates.create({
        sop_template_id: sopId,
        company_id: activeCompanyId,
        name: name.trim(),
        description: description.trim(),
        definition_json: JSON.stringify(definition),
        source_thread_id: null,
        source_url: null,
        version: null,
        last_synced_at: null,
      });
      resetDraft();
      onOpenChange(false);
      onCreated?.();
    } finally {
      setSaving(false);
    }
  }, [
    repos,
    activeCompanyId,
    validate,
    name,
    description,
    steps,
    resetDraft,
    onOpenChange,
    onCreated,
  ]);

  return (
    <>
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        title="Create SOP"
        description="Define a reusable Standard Operating Procedure."
        onRequestClose={handleRequestClose}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={requestClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : 'Create SOP'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          {/* Name & Description */}
          <div className="space-y-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SOP name..."
              className="w-full rounded-lg border border-border-default bg-surface px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
            />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Steps ({steps.length})
              </span>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-0.5 text-[10px] text-accent-text hover:text-accent"
              >
                <Plus className="w-3 h-3" /> Add Step
              </button>
            </div>

            {steps.map((step, i) => (
              <div
                key={step.step_id}
                className="space-y-1.5 rounded-lg border border-border-default bg-surface-muted p-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 font-mono text-[10px] text-text-muted">
                    #{i + 1}
                  </span>
                  <input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step label"
                    className="flex-1 rounded border border-border-default bg-surface px-1.5 py-0.5 text-xs text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
                  />
                  <select
                    value={step.role_slug}
                    onChange={(e) => updateStep(i, { role_slug: e.target.value as RoleSlug })}
                    className="rounded border border-border-default bg-surface px-1 py-0.5 text-[10px] text-text-secondary focus:border-border-focus focus:outline-none"
                  >
                    {HIREABLE_ROLES.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="text-text-muted transition-colors hover:text-error"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <textarea
                  value={step.instruction}
                  onChange={(e) => updateStep(i, { instruction: e.target.value })}
                  placeholder="Instruction for this step..."
                  rows={2}
                  className="w-full resize-none rounded border border-border-default bg-surface px-1.5 py-1 text-[11px] text-text-secondary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
                />
                {i > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-text-muted">After:</span>
                    {steps.slice(0, i).map((prev) => {
                      const selected = step.dependencies.includes(prev.step_id);
                      return (
                        <button
                          key={prev.step_id}
                          type="button"
                          onClick={() => {
                            updateStep(i, {
                              dependencies: selected
                                ? step.dependencies.filter((d) => d !== prev.step_id)
                                : [...step.dependencies, prev.step_id],
                            });
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                            selected
                              ? 'border border-border-focus bg-accent-muted text-accent-text'
                              : 'border border-border-default bg-surface-muted text-text-muted hover:border-border-strong'
                          }`}
                        >
                          #{steps.indexOf(prev) + 1}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Validation errors */}
          {errors.length > 0 && (
            <div className="space-y-0.5 rounded border border-error bg-error-muted p-2">
              {errors.map((err) => (
                <p key={err} className="text-[10px] text-error">
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
