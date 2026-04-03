import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import type { CompanyPolicy } from '../components/company/PolicyEditor';
import { DEFAULT_COMPANY_POLICY } from '../components/company/PolicyEditor';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

export type { CompanyPolicy };

interface CompanyInfo {
  name: string;
  description: string;
}

const DEFAULT_COMPANY: CompanyInfo = { name: '', description: '' };

export interface UseCompanyEditorReturn {
  /** Basic company info (null while loading). */
  company: CompanyInfo | null;
  policy: CompanyPolicy;
  updateCompanyName: (name: string) => void;
  updateCompanyDescription: (desc: string) => void;
  updatePolicy: (policy: CompanyPolicy) => void;
  save: () => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Manages company-level settings: name/description and new-employee policy defaults.
 *
 * Zone layout is now owned by OfficeEditorOverlay via useOfficeLayout.
 * This hook reads/writes only the `policy` key in layout_json, preserving
 * any other keys (e.g. `zoneProps` written by OfficeEditorOverlay).
 */
export function useCompanyEditor(): UseCompanyEditorReturn {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();

  const [isOpen, setIsOpen] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [policy, setPolicy] = useState<CompanyPolicy>(DEFAULT_COMPANY_POLICY);

  const [originalCompany, setOriginalCompany] = useState<CompanyInfo>(DEFAULT_COMPANY);
  const [originalPolicy, setOriginalPolicy] = useState<CompanyPolicy>(DEFAULT_COMPANY_POLICY);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeCompanyId || !repos) return;
    const companyId = activeCompanyId;
    const db = repos;

    async function load() {
      const companyRow = await db.companies.findById(companyId).catch(() => null);
      let info: CompanyInfo;
      if (companyRow) {
        let desc = '';
        try {
          const parsed = JSON.parse(companyRow.default_model_policy_json ?? '{}') as Record<
            string,
            unknown
          >;
          desc = typeof parsed.description === 'string' ? parsed.description : '';
        } catch {
          /* ignore */
        }
        info = { name: companyRow.name, description: desc };
      } else {
        info = DEFAULT_COMPANY;
      }

      const layoutRow = await db.officeLayouts.findActive(companyId).catch(() => null);
      let loadedPolicy: CompanyPolicy = DEFAULT_COMPANY_POLICY;

      if (layoutRow?.layout_json) {
        try {
          const parsed = JSON.parse(layoutRow.layout_json) as Record<string, unknown>;
          if (parsed.policy && typeof parsed.policy === 'object') {
            const p = parsed.policy as Record<string, unknown>;
            loadedPolicy = {
              defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel : '',
              defaultTemperature:
                typeof p.defaultTemperature === 'number' ? p.defaultTemperature : 0.7,
              defaultMaxTokens: typeof p.defaultMaxTokens === 'number' ? p.defaultMaxTokens : 4096,
            };
          }
        } catch {
          /* ignore */
        }
      }

      setCompany(info);
      setOriginalCompany(info);
      setPolicy(loadedPolicy);
      setOriginalPolicy(loadedPolicy);
    }

    void load();
  }, [isOpen, repos, activeCompanyId]);

  const isDirty = useMemo(
    () =>
      JSON.stringify(company) !== JSON.stringify(originalCompany) ||
      JSON.stringify(policy) !== JSON.stringify(originalPolicy),
    [company, originalCompany, policy, originalPolicy],
  );

  const updateCompanyName = useCallback((name: string) => {
    setCompany((prev) => (prev ? { ...prev, name } : { name, description: '' }));
  }, []);

  const updateCompanyDescription = useCallback((description: string) => {
    setCompany((prev) => (prev ? { ...prev, description } : { name: '', description }));
  }, []);

  const updatePolicy = useCallback((p: CompanyPolicy) => setPolicy(p), []);

  const save = useCallback(async () => {
    if (!repos || !activeCompanyId) return;
    const companyId = activeCompanyId;
    const db = repos;
    setIsSaving(true);
    try {
      const layoutRow = await db.officeLayouts.findActive(companyId).catch(() => null);
      // Preserve existing keys in layout_json (especially zoneProps from OfficeEditorOverlay)
      let existing: Record<string, unknown> = {};
      try {
        if (layoutRow?.layout_json)
          existing = JSON.parse(layoutRow.layout_json) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      const layoutJson = JSON.stringify({ ...existing, policy });

      if (layoutRow) {
        await db.officeLayouts.update(layoutRow.layout_id, { layout_json: layoutJson });
      } else {
        const newLayout = await db.officeLayouts.create({
          layout_id: `layout-${Date.now()}`,
          company_id: companyId,
          name: 'Default Layout',
          layout_json: layoutJson,
          is_active: 1,
        });
        await db.officeLayouts.setActive(companyId, newLayout.layout_id);
      }

      // Persist company name + description
      const snapshot = company ?? DEFAULT_COMPANY;
      await db.companies.update(companyId, {
        name: snapshot.name,
        default_model_policy_json: JSON.stringify({ description: snapshot.description }),
      });

      setOriginalCompany(snapshot);
      setOriginalPolicy(policy);
    } finally {
      setIsSaving(false);
    }
  }, [repos, company, policy, activeCompanyId]);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    setCompany(originalCompany);
    setPolicy(originalPolicy);
  }, [originalCompany, originalPolicy]);

  return {
    company,
    policy,
    updateCompanyName,
    updateCompanyDescription,
    updatePolicy,
    save,
    isDirty,
    isSaving,
    isOpen,
    open,
    close,
  };
}
