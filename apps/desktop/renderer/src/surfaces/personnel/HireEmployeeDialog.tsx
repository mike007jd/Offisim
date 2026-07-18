import { useUiState } from '@/app/ui-state.js';
import { useAgentRuntimeModels } from '@/assistant/composer/usePiAgentModels.js';
import { reposOrNull } from '@/data/adapters.js';
import { useReassignEmployee } from '@/data/queries.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { THINKING_LEVELS } from '@/runtime/pi-thread-thinking-store.js';
import { thinkingLevelMeta } from '@/runtime/thinking-level-presentation.js';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { CompactAppearanceEditor } from './AppearanceTab.js';

import { createHireAppearance, newEmployeePersona, roleSlug } from './EmployeeDetail.js';
export function HireEmployeeDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const reassignEmployee = useReassignEmployee();
  const models = useAgentRuntimeModels();
  const nameInputId = useId();
  const roleInputId = useId();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Developer');
  const [model, setModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [appearanceSetup, setAppearanceSetup] = useState(createHireAppearance);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selectedRuntime = models.data?.find((option) => option.value === model);
  const supportsReasoning = selectedRuntime?.reasoning === true;
  const canSubmit = name.trim().length > 0 && role.trim().length > 0 && !isSaving;

  const reset = () => {
    setName('');
    setRole('Developer');
    setModel('');
    setThinkingLevel('');
    setAppearanceSetup(createHireAppearance());
    setError(null);
    setIsSaving(false);
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee creation requires the release desktop app');
      const slug = roleSlug(role);
      const { employee_id } = await repos.employees.create({
        employee_id: appearanceSetup.seed,
        company_id: companyId,
        name: name.trim(),
        role_slug: slug,
        source_asset_id: null,
        source_package_id: null,
        persona_json: JSON.stringify(newEmployeePersona(appearanceSetup.draft)),
        config_json: '{}',
        model: model || null,
        thinking_level: model && supportsReasoning && thinkingLevel ? thinkingLevel : null,
      });
      const zones = await repos.zones.findByCompany(companyId);
      const firstDesk = zones.find((zone) => zone.archetype === 'workspace');
      if (firstDesk) {
        try {
          await reassignEmployee.mutateAsync({
            employeeId: employee_id,
            zoneId: firstDesk.zone_id,
          });
        } catch (assignmentError) {
          await repos.employees.delete(employee_id);
          throw assignmentError;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      useUiState.getState().selectEmployee(employee_id);
      toast.success(`${name.trim()} hired`);
      onOpenChange(false);
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Employee creation failed';
      setError(message);
      toast.error('Employee creation failed', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="off-pers-hire-dialog">
        <DialogHeader>
          <DialogTitle>Hire employee</DialogTitle>
          <DialogDescription>
            Create an internal AI employee in the active company roster.
          </DialogDescription>
        </DialogHeader>
        <div className="off-pers-hire-form">
          <div className="off-pers-hire-field">
            <label htmlFor={nameInputId}>Name</label>
            <Input
              id={nameInputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mara Quinn"
              autoFocus
            />
          </div>
          <div className="off-pers-hire-field">
            <label htmlFor={`${roleInputId}-model`}>
              {selectedRuntime?.selectionKind === 'orchestration-engine' ? 'Engine' : 'Model'}
            </label>
            <Select
              id={`${roleInputId}-model`}
              value={model}
              onChange={(event) => {
                const next = event.target.value;
                setModel(next);
                if (models.data?.find((option) => option.value === next)?.reasoning !== true) {
                  setThinkingLevel('');
                }
              }}
              disabled={models.isLoading}
              options={[
                {
                  value: '',
                  label: models.isLoading ? 'Loading available AI…' : "Use each conversation's AI",
                },
                ...(models.data ?? []).map((option) => ({
                  value: option.value,
                  label: `${option.accountName} · ${option.name}`,
                })),
              ]}
            />
          </div>
          {supportsReasoning ? (
            <div className="off-pers-hire-field">
              <label htmlFor={`${roleInputId}-thinking`}>Reasoning effort</label>
              <Select
                id={`${roleInputId}-thinking`}
                value={thinkingLevel}
                onChange={(event) => setThinkingLevel(event.target.value)}
                options={[
                  { value: '', label: 'Use conversation level' },
                  ...THINKING_LEVELS.map((level) => ({
                    value: level,
                    label: thinkingLevelMeta(level).label,
                  })),
                ]}
              />
            </div>
          ) : null}
          <div className="off-pers-hire-field">
            <label htmlFor={roleInputId}>Role</label>
            <Input
              id={roleInputId}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Frontend Engineer"
            />
          </div>
          <CompactAppearanceEditor
            seed={appearanceSetup.seed}
            role={role}
            draft={appearanceSetup.draft}
            onChange={(draft) => setAppearanceSetup((current) => ({ ...current, draft }))}
          />
          {error ? <p className="off-pers-hire-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            <Icon icon={UserPlus} size="sm" />
            {isSaving ? 'Hiring...' : 'Hire'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
