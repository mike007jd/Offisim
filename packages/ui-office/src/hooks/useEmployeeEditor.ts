import type { EmployeeRow, EmployeeUpdate } from '@aics/core/browser';
import {
  employeeCreated,
  employeeDeleted,
  employeeUpdated,
  employeeWorkstationChanged,
} from '@aics/core/browser';
import { useCallback, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

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
  role_slug: string;
  enabled: boolean;
  workstation_id: string | null;
  expertise: string;
  style: string;
  customInstructions: string;
  modelPreference: string;
  temperature: number;
  maxTokens: number;
  appearance: AvatarAppearance;
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
  appearance: DEFAULT_APPEARANCE,
};

function parsePersonaJson(
  raw: string | null,
): Pick<EmployeeFormData, 'expertise' | 'style' | 'customInstructions' | 'appearance'> {
  if (!raw) return { expertise: '', style: '', customInstructions: '', appearance: DEFAULT_APPEARANCE };
  try {
    const parsed = JSON.parse(raw);
    return {
      expertise: parsed.expertise ?? '',
      style: parsed.style ?? '',
      customInstructions: parsed.customInstructions ?? '',
      appearance: parsed.appearance ?? DEFAULT_APPEARANCE,
    };
  } catch {
    return { expertise: '', style: '', customInstructions: '', appearance: DEFAULT_APPEARANCE };
  }
}

function parseConfigJson(
  raw: string | null,
): Pick<EmployeeFormData, 'modelPreference' | 'temperature' | 'maxTokens'> {
  if (!raw) return { modelPreference: '', temperature: 0.7, maxTokens: 4096 };
  try {
    const parsed = JSON.parse(raw);
    return {
      modelPreference: parsed.modelPreference ?? '',
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.7,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : 4096,
    };
  } catch {
    return { modelPreference: '', temperature: 0.7, maxTokens: 4096 };
  }
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
  };
}

export interface UseEmployeeEditorReturn {
  isOpen: boolean;
  employeeId: string | null;
  formData: EmployeeFormData;
  isDirty: boolean;
  isSaving: boolean;
  isConfirmingDelete: boolean;
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
  const { repos, eventBus, employeeVersionService: versionService } = useAicsRuntime();
  const { activeCompanyId } = useCompany();

  const [isOpen, setIsOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(DEFAULT_FORM);
  const [originalData, setOriginalData] = useState<EmployeeFormData>(DEFAULT_FORM);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
    setIsOpen(true);
  }, []);

  const save = useCallback(async () => {
    if (!repos) return;
    setIsSaving(true);

    try {
      const personaJson = JSON.stringify({
        expertise: formData.expertise,
        style: formData.style,
        customInstructions: formData.customInstructions,
        appearance: formData.appearance,
      });
      const configJson = JSON.stringify({
        modelPreference: formData.modelPreference,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
      });

      if (employeeId) {
        // Update existing employee
        const patch: EmployeeUpdate = {
          name: formData.name,
          role_slug: formData.role_slug,
          enabled: formData.enabled ? 1 : 0,
          workstation_id: formData.workstation_id,
          persona_json: personaJson,
          config_json: configJson,
        };
        await repos.employees.update(employeeId, patch);
        eventBus.emit(employeeUpdated(activeCompanyId!, employeeId, formData.name, formData.role_slug));

        // Emit workstation change if it differs from original
        if (formData.workstation_id !== originalData.workstation_id) {
          eventBus.emit(
            employeeWorkstationChanged(
              activeCompanyId!,
              employeeId,
              originalData.workstation_id,
              formData.workstation_id,
            ),
          );
        }
        // Snapshot current state as a new version
        await versionService?.createVersion(employeeId, 'update');
      } else {
        // Create new employee
        const result = await repos.employees.create({
          company_id: activeCompanyId!,
          name: formData.name,
          role_slug: formData.role_slug,
          source_asset_id: null,
          source_package_id: null,
          persona_json: personaJson,
          config_json: configJson,
        });
        eventBus.emit(
          employeeCreated(activeCompanyId!, result.employee_id, formData.name, formData.role_slug),
        );
        // Snapshot initial state as version 1
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
  }, [repos, eventBus, versionService, employeeId, formData]);

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const requestDelete = useCallback(() => {
    setIsConfirmingDelete(true);
  }, []);

  const cancelDelete = useCallback(() => {
    setIsConfirmingDelete(false);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!repos || !employeeId) return;
    setIsSaving(true);
    try {
      await repos.employees.delete(employeeId);
      eventBus.emit(employeeDeleted(activeCompanyId!, employeeId));
      setIsOpen(false);
      setEmployeeId(null);
      setFormData(DEFAULT_FORM);
      setOriginalData(DEFAULT_FORM);
      setIsDirty(false);
      setIsConfirmingDelete(false);
    } finally {
      setIsSaving(false);
    }
  }, [repos, eventBus, employeeId]);

  const close = useCallback(() => {
    setIsOpen(false);
    setEmployeeId(null);
    setFormData(DEFAULT_FORM);
    setOriginalData(DEFAULT_FORM);
    setIsDirty(false);
  }, []);

  return {
    isOpen,
    employeeId,
    formData,
    isDirty,
    isSaving,
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
