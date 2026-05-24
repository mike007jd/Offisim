import { SopService, generateId } from '@offisim/core/browser';
import type { RoleSlug, SopDefinition, SopStep } from '@offisim/shared-types';
import {
  Button,
  DialogShell,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToastBanner,
  cn,
  useToasts,
} from '@offisim/ui-core';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast';
import { HIREABLE_ROLES } from '../../lib/roles';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
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
  const { repos, eventBus } = useOffisimRuntimeServices();
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
        <div className="sop-editor">
          <div className="sop-editor-fieldset">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SOP name..."
              className="sop-editor-input"
            />
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="sop-editor-input sop-editor-input-secondary"
            />
          </div>

          <div className="sop-editor-steps">
            <div className="sop-editor-steps-head">
              <span className="sop-editor-label">Steps ({steps.length})</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addStep}
                className="sop-editor-add-step"
              >
                <Plus data-icon="editor-action" aria-hidden="true" /> Add Step
              </Button>
            </div>

            {steps.map((step, i) => (
              <div key={step.step_id} className="sop-editor-step">
                <div className="sop-editor-step-row">
                  <span className="sop-editor-step-index">#{i + 1}</span>
                  <Input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step label"
                    className="sop-editor-step-input"
                  />
                  <Select
                    value={step.role_slug}
                    onValueChange={(value) => updateStep(i, { role_slug: value as RoleSlug })}
                  >
                    <SelectTrigger className="sop-editor-role-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HIREABLE_ROLES.map((r) => (
                        <SelectItem key={r.slug} value={r.slug}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeStep(i)}
                      className="sop-editor-remove-step"
                      aria-label={`Remove step ${i + 1}`}
                    >
                      <Trash2 data-icon="editor-remove" aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <Textarea
                  value={step.instruction}
                  onChange={(e) => updateStep(i, { instruction: e.target.value })}
                  placeholder="Instruction for this step..."
                  rows={2}
                  className="sop-editor-instruction"
                />
                {i > 0 && (
                  <div className="sop-editor-dependencies">
                    <span className="sop-editor-dependency-label">After:</span>
                    {steps.slice(0, i).map((prev) => {
                      const selected = step.dependencies.includes(prev.step_id);
                      return (
                        <Button
                          key={prev.step_id}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            updateStep(i, {
                              dependencies: selected
                                ? step.dependencies.filter((d) => d !== prev.step_id)
                                : [...step.dependencies, prev.step_id],
                            });
                          }}
                          className={cn(
                            'sop-editor-dependency-chip',
                            selected
                              ? 'sop-editor-dependency-chip-active'
                              : 'sop-editor-dependency-chip-idle',
                          )}
                        >
                          #{steps.indexOf(prev) + 1}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {errors.length > 0 && (
            <div className="sop-editor-errors">
              {errors.map((err) => (
                <p key={err}>{err}</p>
              ))}
            </div>
          )}
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
