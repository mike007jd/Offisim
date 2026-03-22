import { CompanyTemplateService, listTemplates } from '@aics/core/browser';
import type { CompanyTemplate } from '@aics/core/browser';
import { useCallback, useEffect, useState } from 'react';

import { useCompany } from '../components/company/CompanyContext.js';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

export type CreationStep = 'checking' | 'first-run' | 'creating' | 'ready';

export interface UseCompanyCreationReturn {
  step: CreationStep;
  templates: CompanyTemplate[];
  selectedTemplateId: string | null;
  companyName: string;
  setSelectedTemplateId: (id: string) => void;
  setCompanyName: (name: string) => void;
  create: () => Promise<void>;
  error: string | null;
  runtimeReady: boolean;
}

export function useCompanyCreation(): UseCompanyCreationReturn {
  const { repos, eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const [step, setStep] = useState<CreationStep>('checking');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('My AI Company');
  const [error, setError] = useState<string | null>(null);
  const [templates] = useState<CompanyTemplate[]>(() => listTemplates());

  // Check if this is first run.
  // When repos is null (no provider configured yet), show wizard so user can pick a template.
  useEffect(() => {
    if (!repos) {
      setStep('first-run');
      return;
    }
    if (!activeCompanyId) {
      setStep('first-run');
      return;
    }
    (async () => {
      try {
        const employees = await repos.employees.findByCompany(activeCompanyId);
        setStep(employees.length === 0 ? 'first-run' : 'ready');
      } catch {
        setStep('first-run');
      }
    })();
  }, [repos, activeCompanyId]);

  const runtimeReady = repos !== null;

  const create = useCallback(async () => {
    if (!selectedTemplateId) return;
    if (!repos) {
      setError('Runtime is still initializing. Please wait a moment and try again.');
      return;
    }
    if (!activeCompanyId) {
      setError('No active company. Please wait a moment and try again.');
      return;
    }
    setStep('creating');
    setError(null);
    try {
      const service = new CompanyTemplateService(
        repos.employees,
        repos.sopTemplates,
        repos.officeLayouts,
        eventBus,
        repos.prefabInstances,
      );
      await service.materializeTemplate(selectedTemplateId, activeCompanyId);
      setStep('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company');
      setStep('first-run');
    }
  }, [repos, selectedTemplateId, eventBus, activeCompanyId]);

  return {
    step,
    templates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    error,
    runtimeReady,
  };
}
