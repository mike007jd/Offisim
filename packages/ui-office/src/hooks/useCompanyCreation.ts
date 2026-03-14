import { CompanyTemplateService, listTemplates } from '@aics/core/browser';
import type { CompanyTemplate } from '@aics/core/browser';
import { useCallback, useEffect, useState } from 'react';

import { COMPANY_ID } from '../lib/constants.js';
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
}

export function useCompanyCreation(): UseCompanyCreationReturn {
  const { repos, eventBus, reinitRuntime } = useAicsRuntime();
  const [step, setStep] = useState<CreationStep>('checking');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('My AI Company');
  const [error, setError] = useState<string | null>(null);
  const [templates] = useState<CompanyTemplate[]>(() => listTemplates());

  // Check if this is first run — only when repos are available.
  // When repos is null (no provider configured), skip wizard entirely.
  useEffect(() => {
    if (!repos) {
      setStep('ready');
      return;
    }
    (async () => {
      try {
        const employees = await repos.employees.findByCompany(COMPANY_ID);
        setStep(employees.length === 0 ? 'first-run' : 'ready');
      } catch {
        setStep('first-run');
      }
    })();
  }, [repos]);

  const create = useCallback(async () => {
    if (!repos || !selectedTemplateId) return;
    setStep('creating');
    setError(null);
    try {
      const service = new CompanyTemplateService(
        repos.employees,
        repos.sopTemplates,
        repos.officeLayouts,
        eventBus,
      );
      await service.materializeTemplate(selectedTemplateId, COMPANY_ID);
      setStep('ready');
      // Reinit runtime to pick up new employees
      reinitRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create company');
      setStep('first-run');
    }
  }, [repos, selectedTemplateId, eventBus, reinitRuntime]);

  return {
    step,
    templates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    error,
  };
}
