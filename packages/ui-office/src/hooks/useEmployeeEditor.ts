import type {
  EmployeeRow,
  EmployeeUpdate,
  ToolApprovalMode,
  ToolPermissionPolicy,
} from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import {
  employeeCreated,
  employeeDeleted,
  employeeUpdated,
  employeeWorkstationChanged,
} from '@offisim/core/browser';
import type { CommunicationFrequency, DecisionStyle, RiskPreference } from '@offisim/shared-types';
import { useCallback, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

export interface AvatarAppearance {
  skinColor: number;
  hairColor: number;
  hairStyle: string;
  clothingColor: number;
  clothingAccent: number;
  bodyType: string;
  gender: 'neutral' | 'masculine' | 'feminine';
}

export interface RuntimeSkillCapability {
  kind?: string;
  key?: string;
  label?: string;
}

export interface RuntimeSkillConfig {
  skillName: string;
  summary: string;
  enabled?: boolean;
  instructionMode?: string;
  instructionExcerpt?: string;
  instructions?: string;
  capabilityIndex?: {
    summary?: string;
    requiredCapabilities?: string[];
    capabilities?: RuntimeSkillCapability[];
  };
  allowedTools?: string[];
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
  runtimeSkill: RuntimeSkillConfig | null;
  skillEnabled: boolean;
  toolPermissionPolicy: ToolPermissionPolicy | null;
  communicationFrequency: CommunicationFrequency;
  riskPreference: RiskPreference;
  decisionStyle: DecisionStyle;
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
  runtimeSkill: null,
  skillEnabled: false,
  toolPermissionPolicy: null,
  communicationFrequency: 'medium',
  riskPreference: 'balanced',
  decisionStyle: 'collaborative',
  appearance: DEFAULT_APPEARANCE,
};

function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return value === 'auto' || value === 'ask_first_time' || value === 'always_ask';
}

function parseToolPermissionPolicy(value: unknown): ToolPermissionPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const policy = value as {
    defaultMode?: unknown;
    overrides?: Array<{ pattern?: unknown; mode?: unknown }>;
  };
  if (!isToolApprovalMode(policy.defaultMode)) return null;
  return {
    defaultMode: policy.defaultMode,
    overrides: (policy.overrides ?? []).flatMap((override) => {
      if (
        !override ||
        typeof override.pattern !== 'string' ||
        !override.pattern.trim() ||
        !isToolApprovalMode(override.mode)
      ) {
        return [];
      }
      return [{ pattern: override.pattern, mode: override.mode }];
    }),
  };
}

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
  if (!raw) {
    return {
      expertise: '',
      style: '',
      customInstructions: '',
      appearance: DEFAULT_APPEARANCE,
      communicationFrequency: 'medium',
      riskPreference: 'balanced',
      decisionStyle: 'collaborative',
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      expertise: parsed.expertise ?? '',
      style: parsed.style ?? '',
      customInstructions: parsed.customInstructions ?? '',
      appearance: parsed.appearance ?? DEFAULT_APPEARANCE,
      communicationFrequency: parsed.communicationFrequency ?? 'medium',
      riskPreference: parsed.riskPreference ?? 'balanced',
      decisionStyle: parsed.decisionStyle ?? 'collaborative',
    };
  } catch {
    return {
      expertise: '',
      style: '',
      customInstructions: '',
      appearance: DEFAULT_APPEARANCE,
      communicationFrequency: 'medium',
      riskPreference: 'balanced',
      decisionStyle: 'collaborative',
    };
  }
}

export function parseConfigJson(
  raw: string | null,
): Pick<
  EmployeeFormData,
  | 'modelPreference'
  | 'temperature'
  | 'maxTokens'
  | 'runtimeSkill'
  | 'skillEnabled'
  | 'toolPermissionPolicy'
> {
  if (!raw) {
    return {
      modelPreference: '',
      temperature: 0.7,
      maxTokens: 4096,
      runtimeSkill: null,
      skillEnabled: false,
      toolPermissionPolicy: null,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const runtimeSkill =
      parsed.runtimeSkill && typeof parsed.runtimeSkill === 'object'
        ? (parsed.runtimeSkill as RuntimeSkillConfig)
        : null;
    return {
      modelPreference: parsed.modelPreference ?? '',
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.7,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : 4096,
      runtimeSkill,
      skillEnabled: runtimeSkill !== null && runtimeSkill.enabled !== false,
      toolPermissionPolicy: parseToolPermissionPolicy(parsed.toolPermissionPolicy),
    };
  } catch {
    return {
      modelPreference: '',
      temperature: 0.7,
      maxTokens: 4096,
      runtimeSkill: null,
      skillEnabled: false,
      toolPermissionPolicy: null,
    };
  }
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
    | 'modelPreference'
    | 'temperature'
    | 'maxTokens'
    | 'runtimeSkill'
    | 'skillEnabled'
    | 'toolPermissionPolicy'
  >,
): string {
  return JSON.stringify({
    modelPreference: formData.modelPreference,
    temperature: formData.temperature,
    maxTokens: formData.maxTokens,
    ...(formData.runtimeSkill
      ? {
          runtimeSkill: {
            ...formData.runtimeSkill,
            enabled: formData.skillEnabled,
          },
        }
      : {}),
    ...(formData.toolPermissionPolicy
      ? { toolPermissionPolicy: formData.toolPermissionPolicy }
      : {}),
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
        eventBus.emit(employeeUpdated(companyId, employeeId, formData.name, formData.role_slug));

        // Emit workstation change if it differs from original
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
        // Snapshot current state as a new version
        await versionService?.createVersion(employeeId, 'update');
      } else {
        // Create new employee
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
