import type { EmployeeRow, EmployeeUpdate, ToolPermissionPolicy } from '@offisim/core/browser';
import {
  employeeCreated,
  employeeDeleted,
  employeeUpdated,
  employeeWorkstationChanged,
} from '@offisim/core/browser';
import type { EmployeeRuntimeBinding, RoleSlug } from '@offisim/shared-types';
import type { CommunicationFrequency, DecisionStyle, RiskPreference } from '@offisim/shared-types';
import { parseEmployeeConfig, parseEmployeePersona } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';
import type { SkillMetadata } from '@offisim/shared-types';

export interface AvatarAppearance {
  skinColor: number;
  hairColor: number;
  hairStyle: string;
  clothingColor: number;
  clothingAccent: number;
  bodyType: string;
  gender: 'neutral' | 'masculine' | 'feminine';
}

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  skinColor: 0xfdbcb4,
  hairColor: 0x1a1a1a,
  hairStyle: 'short',
  clothingColor: 0x4a90d9,
  clothingAccent: 0xffffff,
  bodyType: 'normal',
  gender: 'neutral',
};

export interface EmployeeFormData {
  name: string;
  role_slug: RoleSlug;
  enabled: boolean;
  workstation_id: string | null;
  expertise: string;
  style: string;
  customInstructions: string;
  modelPreference: string;
  temperature: number;
  maxTokens: number;
  toolPermissionPolicy: ToolPermissionPolicy | null;
  runtimeBinding: EmployeeRuntimeBinding | null;
  communicationFrequency: CommunicationFrequency;
  riskPreference: RiskPreference;
  decisionStyle: DecisionStyle;
  appearance: AvatarAppearance;
  /** Read-only. External employees render brand avatars and the editor locks the customizer. */
  isExternal: boolean;
  brandKey: string | null;
}

const DEFAULT_FORM: EmployeeFormData = {
  name: '',
  role_slug: 'developer',
  enabled: true,
  workstation_id: null,
  expertise: '',
  style: '',
  customInstructions: '',
  modelPreference: '',
  temperature: 0.7,
  maxTokens: 4096,
  toolPermissionPolicy: null,
  runtimeBinding: null,
  communicationFrequency: 'medium',
  riskPreference: 'balanced',
  decisionStyle: 'collaborative',
  appearance: DEFAULT_APPEARANCE,
  isExternal: false,
  brandKey: null,
};

export function parsePersonaJson(
  raw: string | null,
): Pick<
  EmployeeFormData,
  | 'expertise'
  | 'style'
  | 'customInstructions'
  | 'appearance'
  | 'communicationFrequency'
  | 'riskPreference'
  | 'decisionStyle'
> {
  const persona = parseEmployeePersona(raw);
  return {
    expertise: persona.expertise ?? '',
    style: persona.style ?? '',
    customInstructions: persona.customInstructions ?? '',
    appearance: persona.appearance ?? DEFAULT_APPEARANCE,
    communicationFrequency: persona.communicationFrequency ?? 'medium',
    riskPreference: persona.riskPreference ?? 'balanced',
    decisionStyle: persona.decisionStyle ?? 'collaborative',
  };
}

export function parseConfigJson(
  raw: string | null,
): Pick<
  EmployeeFormData,
  'modelPreference' | 'temperature' | 'maxTokens' | 'toolPermissionPolicy' | 'runtimeBinding'
> {
  const config = parseEmployeeConfig(raw);
  return {
    modelPreference: config.modelPreference ?? '',
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 4096,
    toolPermissionPolicy: (config.toolPermissionPolicy ?? null) as ToolPermissionPolicy | null,
    runtimeBinding: config.runtimeBinding ?? null,
  };
}

export function buildPersonaJson(
  formData: Pick<
    EmployeeFormData,
    | 'expertise'
    | 'style'
    | 'customInstructions'
    | 'appearance'
    | 'communicationFrequency'
    | 'riskPreference'
    | 'decisionStyle'
  >,
): string {
  return JSON.stringify({
    expertise: formData.expertise,
    style: formData.style,
    customInstructions: formData.customInstructions,
    appearance: formData.appearance,
    communicationFrequency: formData.communicationFrequency,
    riskPreference: formData.riskPreference,
    decisionStyle: formData.decisionStyle,
  });
}

export function buildConfigJson(
  formData: Pick<
    EmployeeFormData,
    'modelPreference' | 'temperature' | 'maxTokens' | 'toolPermissionPolicy' | 'runtimeBinding'
  >,
): string {
  return JSON.stringify({
    modelPreference: formData.modelPreference,
    temperature: formData.temperature,
    maxTokens: formData.maxTokens,
    ...(formData.toolPermissionPolicy
      ? { toolPermissionPolicy: formData.toolPermissionPolicy }
      : {}),
    ...(formData.runtimeBinding ? { runtimeBinding: formData.runtimeBinding } : {}),
  });
}

function rowToFormData(row: EmployeeRow): EmployeeFormData {
  const persona = parsePersonaJson(row.persona_json);
  const config = parseConfigJson(row.config_json);
  return {
    name: row.name,
    role_slug: row.role_slug,
    enabled: row.enabled === 1,
    workstation_id: row.workstation_id,
    ...persona,
    ...config,
    isExternal: row.is_external === 1,
    brandKey: row.brand_key,
  };
}

export interface UseEmployeeEditorReturn {
  isOpen: boolean;
  employeeId: string | null;
  formData: EmployeeFormData;
  isDirty: boolean;
  isSaving: boolean;
  isConfirmingDelete: boolean;
  deleteError: string | null;
  /** Non-null when the employee was installed from a marketplace asset. */
  sourceAssetId: string | null;
  sourcePackageId: string | null;
  setFormData: (data: EmployeeFormData) => void;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
  openForEdit: (id: string) => Promise<void>;
  openForCreate: () => void;
  save: () => Promise<void>;
  requestDelete: () => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  close: () => void;
}

export function useEmployeeEditor(): UseEmployeeEditorReturn {
  const { repos, eventBus, employeeVersionService: versionService } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();

  const [isOpen, setIsOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(DEFAULT_FORM);
  const [originalData, setOriginalData] = useState<EmployeeFormData>(DEFAULT_FORM);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const [sourcePackageId, setSourcePackageId] = useState<string | null>(null);

  const updateField = useCallback(
    <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => {
      setFormData((prev) => {
        const next = { ...prev, [key]: value };
        setIsDirty(JSON.stringify(next) !== JSON.stringify(originalData));
        return next;
      });
    },
    [originalData],
  );

  const handleSetFormData = useCallback(
    (data: EmployeeFormData) => {
      setFormData(data);
      setIsDirty(JSON.stringify(data) !== JSON.stringify(originalData));
    },
    [originalData],
  );

  const openForEdit = useCallback(
    async (id: string) => {
      if (!repos) return;
      const row = await repos.employees.findById(id);
      if (!row) return;
      const data = rowToFormData(row);
      setEmployeeId(id);
      setFormData(data);
      setOriginalData(data);
      setIsDirty(false);
      setSourceAssetId(row.source_asset_id ?? null);
      setSourcePackageId(row.source_package_id ?? null);
      setDeleteError(null);
      setIsOpen(true);
    },
    [repos],
  );

  const openForCreate = useCallback(() => {
    setEmployeeId(null);
    setFormData(DEFAULT_FORM);
    setOriginalData(DEFAULT_FORM);
    setIsDirty(false);
    setSourceAssetId(null);
    setSourcePackageId(null);
    setDeleteError(null);
    setIsOpen(true);
  }, []);

  const save = useCallback(async () => {
    if (!repos) return;
    setIsSaving(true);

    try {
      const companyId = activeCompanyId;
      if (!companyId) return;
      const personaJson = buildPersonaJson(formData);
      const configJson = buildConfigJson(formData);

      if (employeeId) {
        const patch: EmployeeUpdate = {
          name: formData.name,
          role_slug: formData.role_slug,
          enabled: formData.enabled ? 1 : 0,
          workstation_id: formData.workstation_id,
          persona_json: personaJson,
          config_json: configJson,
        };
        await repos.employees.update(employeeId, patch);
        eventBus.emit(employeeUpdated(companyId, employeeId, formData.name, formData.role_slug));

        const originalWorkstationId = originalData.workstation_id;
        if (formData.workstation_id !== originalWorkstationId) {
          eventBus.emit(
            employeeWorkstationChanged(
              companyId,
              employeeId,
              originalWorkstationId,
              formData.workstation_id,
            ),
          );
        }
        await versionService?.createVersion(employeeId, 'update');
      } else {
        const result = await repos.employees.create({
          company_id: companyId,
          name: formData.name,
          role_slug: formData.role_slug,
          source_asset_id: null,
          source_package_id: null,
          persona_json: personaJson,
          config_json: configJson,
        });
        eventBus.emit(
          employeeCreated(companyId, result.employee_id, formData.name, formData.role_slug),
        );
        await versionService?.createVersion(result.employee_id, 'create');
      }

      setIsOpen(false);
      setEmployeeId(null);
      setFormData(DEFAULT_FORM);
      setOriginalData(DEFAULT_FORM);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [
    repos,
    eventBus,
    versionService,
    employeeId,
    formData,
    activeCompanyId,
    originalData.workstation_id,
  ]);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const requestDelete = useCallback(() => {
    setDeleteError(null);
    setIsConfirmingDelete(true);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteError(null);
    setIsConfirmingDelete(false);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!repos || !employeeId) return;
    setIsSaving(true);
    setDeleteError(null);
    try {
      const companyId = activeCompanyId;
      if (!companyId) {
        setDeleteError('No active company selected.');
        return;
      }
      await repos.employees.delete(employeeId);
      eventBus.emit(employeeDeleted(companyId, employeeId));
      setIsOpen(false);
      setEmployeeId(null);
      setFormData(DEFAULT_FORM);
      setOriginalData(DEFAULT_FORM);
      setIsDirty(false);
      setIsConfirmingDelete(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete employee.');
    } finally {
      setIsSaving(false);
    }
  }, [repos, eventBus, employeeId, activeCompanyId]);

  const close = useCallback(() => {
    setIsOpen(false);
    setEmployeeId(null);
    setFormData(DEFAULT_FORM);
    setOriginalData(DEFAULT_FORM);
    setIsDirty(false);
    setDeleteError(null);
  }, []);

  return {
    isOpen,
    employeeId,
    formData,
    isDirty,
    isSaving,
    deleteError,
    setFormData: handleSetFormData,
    updateField,
    openForEdit,
    openForCreate,
    save,
    isConfirmingDelete,
    requestDelete,
    cancelDelete,
    confirmDelete,
    close,
    sourceAssetId,
    sourcePackageId,
  };
}

/**
 * Subscribe to the skills tied to a given employee. Returns the merged list
 * (company scope + employee scope, employee overriding company on slug).
 *
 * Refreshes on `skill.*` eventBus notifications so installs / deletes
 * propagate without manual invalidation.
 */
export function useSkillsForEmployee(
  companyId: string | null,
  employeeId: string | null,
): SkillMetadata[] {
  const runtime = useOffisimRuntime();
  const [skills, setSkills] = useState<SkillMetadata[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!companyId || !employeeId) {
        if (!cancelled) setSkills([]);
        return;
      }
      const loader = runtime?.skillLoader;
      if (!loader) {
        if (!cancelled) setSkills([]);
        return;
      }
      try {
        const list = await loader.listSkillsForEmployee(companyId, employeeId);
        if (!cancelled) setSkills(list);
      } catch {
        if (!cancelled) setSkills([]);
      }
    };
    void load();
    const bus = runtime?.eventBus;
    if (!bus) return () => {
      cancelled = true;
    };
    const unsubscribe = bus.on('skill.', () => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [companyId, employeeId, runtime?.skillLoader, runtime?.eventBus]);

  return skills;
}
