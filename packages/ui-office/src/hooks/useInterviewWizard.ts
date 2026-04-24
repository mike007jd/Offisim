import { employeeCreated } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import { useCallback, useReducer, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';
import type { EmployeeFormData } from './useEmployeeEditor';
import { DEFAULT_APPEARANCE } from './useEmployeeEditor';

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

export const WIZARD_STEPS = [
  'role',
  'name',
  'expertise',
  'style',
  'appearance',
  'instructions',
  'model',
  'preview',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Steps that can be skipped (optional content). */
const OPTIONAL_STEPS = new Set<WizardStep>(['appearance', 'instructions', 'model']);

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

export interface WizardState {
  currentStep: number;
  formData: EmployeeFormData;
  completedSteps: Set<number>;
}

export type WizardAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | {
      type: 'updateField';
      key: keyof EmployeeFormData;
      value: EmployeeFormData[keyof EmployeeFormData];
    }
  | { type: 'reset' };

export const DEFAULT_WIZARD_FORM: EmployeeFormData = {
  name: '',
  role_slug: 'developer' as RoleSlug,
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

export const initialWizardState: WizardState = {
  currentStep: 0,
  formData: DEFAULT_WIZARD_FORM,
  completedSteps: new Set<number>(),
};

// ---------------------------------------------------------------------------
// Per-step validation
// ---------------------------------------------------------------------------

export function isStepValid(step: number, formData: EmployeeFormData): boolean {
  const stepName = WIZARD_STEPS[step];
  switch (stepName) {
    case 'role':
      return formData.role_slug.trim() !== '';
    case 'name':
      return formData.name.trim() !== '';
    case 'expertise':
      return formData.expertise.trim() !== '';
    case 'style':
      return formData.style.trim() !== '';
    case 'appearance':
      return true; // optional
    case 'instructions':
      return true; // optional
    case 'model':
      return true; // optional
    case 'preview':
      return true; // always valid — it's a review step
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'next': {
      if (state.currentStep >= WIZARD_STEPS.length - 1) return state;
      const completed = new Set(state.completedSteps);
      completed.add(state.currentStep);
      return { ...state, currentStep: state.currentStep + 1, completedSteps: completed };
    }
    case 'back': {
      if (state.currentStep <= 0) return state;
      return { ...state, currentStep: state.currentStep - 1 };
    }
    case 'goto': {
      const step = action.step;
      if (step < 0 || step >= WIZARD_STEPS.length) return state;
      // Only allow going to completed steps or the current step + 1
      if (step > state.currentStep && !state.completedSteps.has(step)) return state;
      return { ...state, currentStep: step };
    }
    case 'updateField': {
      return {
        ...state,
        formData: { ...state.formData, [action.key]: action.value },
      };
    }
    case 'reset':
      return { ...initialWizardState, completedSteps: new Set() };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseInterviewWizardReturn {
  state: WizardState;
  currentStepName: WizardStep;
  canProceed: boolean;
  isLastStep: boolean;
  isFirstStep: boolean;
  progress: number;
  isSubmitting: boolean;
  /** Returns true on success, false on failure (check `error` for the reason). */
  submit: () => Promise<boolean>;
  error: string | null;
  clearError: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
  reset: () => void;
  canSkip: boolean;
  dispatch: React.Dispatch<WizardAction>;
}

export function useInterviewWizard(): UseInterviewWizardReturn {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const { repos, eventBus, employeeVersionService: versionService } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const currentStepName = WIZARD_STEPS[state.currentStep] as WizardStep;
  const canProceed = isStepValid(state.currentStep, state.formData);
  const isLastStep = state.currentStep === WIZARD_STEPS.length - 1;
  const isFirstStep = state.currentStep === 0;
  const progress = (state.currentStep + 1) / WIZARD_STEPS.length;
  const canSkip = OPTIONAL_STEPS.has(currentStepName);

  const next = useCallback(() => {
    if (canProceed || canSkip) {
      dispatch({ type: 'next' });
    }
  }, [canProceed, canSkip]);

  const back = useCallback(() => {
    dispatch({ type: 'back' });
  }, []);

  const skip = useCallback(() => {
    if (canSkip) {
      dispatch({ type: 'next' });
    }
  }, [canSkip]);

  const updateField = useCallback(
    <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => {
      dispatch({ type: 'updateField', key, value });
    },
    [],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const submit = useCallback(async (): Promise<boolean> => {
    // Synchronous re-entry guard — isSubmitting state lags a render, so a
    // same-tick double Enter / double click would otherwise slip through and
    // create duplicate employees.
    if (submittingRef.current) return false;
    if (!repos) {
      setError('Runtime not ready — please wait and retry');
      return false;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const { formData } = state;
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

      if (!activeCompanyId) throw new Error('No active company');
      const result = await repos.employees.create({
        company_id: activeCompanyId,
        name: formData.name,
        role_slug: formData.role_slug,
        source_asset_id: null,
        source_package_id: null,
        persona_json: personaJson,
        config_json: configJson,
      });

      eventBus.emit(
        employeeCreated(activeCompanyId, result.employee_id, formData.name, formData.role_slug),
      );
      await versionService?.createVersion(result.employee_id, 'create');

      dispatch({ type: 'reset' });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create employee');
      return false;
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }, [repos, eventBus, versionService, state, activeCompanyId]);

  return {
    state,
    currentStepName,
    canProceed,
    isLastStep,
    isFirstStep,
    progress,
    isSubmitting,
    submit,
    error,
    clearError,
    next,
    back,
    skip,
    updateField,
    reset,
    canSkip,
    dispatch,
  };
}
