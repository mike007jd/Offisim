import { generateId, SopService } from '@offisim/core/browser';
import { ROLE_REGISTRY } from '@offisim/shared-types';
import type { RoleSlug, SopDefinition, SopStep } from '@offisim/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@offisim/ui-core';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useCompany } from '../company/CompanyContext.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';

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

const HIREABLE_ROLES = ROLE_REGISTRY.filter((r) => !r.isSystem);

interface SopEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function SopEditorDialog({ open, onOpenChange, onCreated }: SopEditorDialogProps) {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([makeEmptyStep(0)]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const sopService = useMemo(() => {
    if (!repos?.sopTemplates) return null;
    return new SopService(repos.sopTemplates, eventBus);
  }, [repos, eventBus]);

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
      // Reset
      setName('');
      setDescription('');
      setSteps([makeEmptyStep(0)]);
      setErrors([]);
      onOpenChange(false);
      onCreated?.();
    } finally {
      setSaving(false);
    }
  }, [repos, activeCompanyId, validate, name, description, steps, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create SOP</DialogTitle>
          <DialogDescription>Define a reusable Standard Operating Procedure.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {/* Name & Description */}
          <div className="space-y-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SOP name..."
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Steps ({steps.length})
              </span>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-3 h-3" /> Add Step
              </button>
            </div>

            {steps.map((step, i) => (
              <div
                key={step.step_id}
                className="rounded-lg border border-white/5 bg-white/[0.02] p-2 space-y-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-mono shrink-0 w-12">
                    #{i + 1}
                  </span>
                  <input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Step label"
                    className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
                  />
                  <select
                    value={step.role_slug}
                    onChange={(e) => updateStep(i, { role_slug: e.target.value as RoleSlug })}
                    className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-blue-500/50"
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
                      className="text-slate-600 hover:text-red-400 transition-colors"
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
                  className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none focus:border-blue-500/50"
                />
                {i > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[9px] text-slate-600">After:</span>
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
                          className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                            selected
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-white/5 text-slate-500 border border-white/10 hover:border-white/20'
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
            <div className="rounded border border-red-500/20 bg-red-500/5 p-2 space-y-0.5">
              {errors.map((err) => (
                <p key={err} className="text-[10px] text-red-400">
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Create SOP'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
