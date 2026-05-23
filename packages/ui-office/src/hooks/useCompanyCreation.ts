import {
  CompanyTemplateService,
  companyStartupCompleted,
  companyStartupRequested,
  companyStartupStarted,
  listTemplates,
} from '@offisim/core/browser';
import type { CompanyTemplate } from '@offisim/core/browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useCompany } from '../components/company/CompanyContext.js';
import {
  useOffisimRuntimeExecution,
  useOffisimRuntimeServices,
} from '../runtime/offisim-runtime-context.js';

export type CreationStep = 'checking' | 'first-run' | 'creating' | 'ready';
export type CompanyCreationMode = 'create-new' | 'populate-existing';

interface UseCompanyCreationOptions {
  mode?: CompanyCreationMode;
  companyId?: string | null;
}

export interface UseCompanyCreationReturn {
  step: CreationStep;
  templates: CompanyTemplate[];
  selectedTemplateId: string | null;
  companyName: string;
  setSelectedTemplateId: (id: string) => void;
  setCompanyName: (name: string) => void;
  create: () => Promise<string | null>;
  createCustomCompany: () => Promise<string | null>;
  error: string | null;
  runtimeReady: boolean;
  /** True while any create flow is in flight (template or custom). */
  isCreating: boolean;
}

export function useCompanyCreation({
  mode = 'populate-existing',
  companyId: explicitCompanyId,
}: UseCompanyCreationOptions = {}): UseCompanyCreationReturn {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { isReady: providerReady } = useOffisimRuntimeExecution();
  const { activeCompanyId } = useCompany();
  const targetCompanyId = explicitCompanyId ?? activeCompanyId;
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
    if (mode === 'create-new') {
      setStep('first-run');
      return;
    }
    if (!targetCompanyId) {
      setStep('first-run');
      return;
    }
    (async () => {
      try {
        const employees = await repos.employees.findByCompany(targetCompanyId);
        setStep(employees.length === 0 ? 'first-run' : 'ready');
      } catch {
        setStep('first-run');
      }
    })();
  }, [repos, mode, targetCompanyId]);

  const runtimeReady = repos !== null;

  // Guard against double-submit (e.g. Settings dialog opens during creation).
  // creatingRef is the synchronous source of truth; isCreating is the
  // mirrored React state exposed to consumers that need to render/gate on it
  // (e.g. CompanyCreationWizard's Back/Escape dismissal).
  const creatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);

  const emitStartupLifecycle = useCallback(
    (
      companyId: string,
      source: 'template' | 'custom',
      template?: { id: string; name: string } | null,
    ) => {
      const startupId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? `startup-${crypto.randomUUID()}`
          : `startup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestedAt = Date.now();
      const eventOptions = {
        startupId,
        source,
        providerReady,
        replay: false,
        requestedAt,
        templateId: template?.id ?? null,
        templateLabel: template?.name ?? null,
      };
      eventBus.emit(companyStartupRequested(companyId, eventOptions));
      eventBus.emit(companyStartupStarted(companyId, eventOptions));
      eventBus.emit(
        companyStartupCompleted(companyId, {
          ...eventOptions,
          completedAt: Date.now(),
        }),
      );
    },
    [eventBus, providerReady],
  );

  const createCompanyRecord = useCallback(
    async (template: CompanyTemplate | null, templateLabelOverride?: string) => {
      if (!repos) {
        setError('Runtime is still initializing. Please wait a moment and try again.');
        return null;
      }

      const now = new Date().toISOString();
      const newCompanyId = crypto.randomUUID();
      await repos.companies.create({
        company_id: newCompanyId,
        name: companyName.trim(),
        status: 'active',
        template_id: template?.id ?? null,
        template_label: templateLabelOverride ?? template?.name ?? 'Custom',
        workspace_root: null,
        default_model_policy_json: null,
        created_at: now,
        updated_at: now,
      });
      return newCompanyId;
    },
    [companyName, repos],
  );

  const create = useCallback(async () => {
    if (!selectedTemplateId || creatingRef.current) return null;
    creatingRef.current = true;
    setIsCreating(true);
    try {
      if (!repos) {
        setError('Runtime is still initializing. Please wait a moment and try again.');
        return null;
      }
      const selectedTemplate =
        templates.find((template) => template.id === selectedTemplateId) ?? null;
      if (!selectedTemplate) {
        setError('Selected template not found.');
        return null;
      }

      const creatingNewCompany = mode === 'create-new' || !targetCompanyId;
      const resolvedCompanyId = creatingNewCompany
        ? await createCompanyRecord(selectedTemplate)
        : targetCompanyId;
      if (!resolvedCompanyId) return null;

      if (!creatingNewCompany) {
        try {
          const existing = await repos.employees.findByCompany(resolvedCompanyId);
          if (existing.length > 0) {
            setStep('ready');
            return resolvedCompanyId;
          }
        } catch {
          /* proceed with creation */
        }
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
          repos.transact,
          repos.zones,
        );
        await service.materializeTemplate(selectedTemplateId, resolvedCompanyId);
        if (!creatingNewCompany) {
          await repos.companies.update(resolvedCompanyId, {
            template_id: selectedTemplate.id,
            template_label: selectedTemplate.name,
          });
        }
        emitStartupLifecycle(resolvedCompanyId, 'template', selectedTemplate);
        setStep('ready');
        return resolvedCompanyId;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create company');
        setStep('first-run');
        return null;
      }
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  }, [
    repos,
    selectedTemplateId,
    eventBus,
    targetCompanyId,
    mode,
    templates,
    createCompanyRecord,
    emitStartupLifecycle,
  ]);

  const createCustomCompany = useCallback(async () => {
    if (creatingRef.current) return null;
    if (!companyName.trim()) {
      setError('Please enter a company name.');
      return null;
    }
    creatingRef.current = true;
    setIsCreating(true);
    setError(null);
    try {
      const newCompanyId = await createCompanyRecord(null, 'Custom');
      if (newCompanyId) emitStartupLifecycle(newCompanyId, 'custom', null);
      return newCompanyId;
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  }, [companyName, createCompanyRecord, emitStartupLifecycle]);

  return {
    step,
    templates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    createCustomCompany,
    error,
    runtimeReady,
    isCreating,
  };
}
