import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ZoneConfig } from '../components/company/ZoneEditor';
import type { CompanyPolicy } from '../components/company/PolicyEditor';
import { DEFAULT_COMPANY_POLICY } from '../components/company/PolicyEditor';
import { COMPANY_ID } from '../lib/constants';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export type { ZoneConfig, CompanyPolicy };

interface CompanyInfo {
  name: string;
  description: string;
}

const DEFAULT_COMPANY: CompanyInfo = { name: '', description: '' };

const DEFAULT_ZONES: ZoneConfig[] = [
  { id: 'zone-dev', name: 'Development', color: '#3b82f6', employeeCount: 0 },
  { id: 'zone-prod', name: 'Production', color: '#8b5cf6', employeeCount: 0 },
  { id: 'zone-art', name: 'Art & Design', color: '#92400e', employeeCount: 0 },
];

export interface UseCompanyEditorReturn {
  /** Basic company info (null while loading). */
  company: CompanyInfo | null;
  zones: ZoneConfig[];
  policy: CompanyPolicy;
  updateCompanyName: (name: string) => void;
  updateCompanyDescription: (desc: string) => void;
  updateZones: (zones: ZoneConfig[]) => void;
  updatePolicy: (policy: CompanyPolicy) => void;
  save: () => Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Manages company-level settings: name/description, department zones, and
 * new-employee policy defaults.
 *
 * The hook reads the active office layout to derive zones and stores policy
 * as a JSON blob in the layout's `layout_json`.  If repos are unavailable
 * (runtime not ready, or running in a context without persistence) the hook
 * operates purely in local state so the UI is always usable.
 */
export function useCompanyEditor(): UseCompanyEditorReturn {
  const { repos } = useAicsRuntime();

  const [isOpen, setIsOpen] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [zones, setZones] = useState<ZoneConfig[]>(DEFAULT_ZONES);
  const [policy, setPolicy] = useState<CompanyPolicy>(DEFAULT_COMPANY_POLICY);

  // Snapshot for dirty tracking
  const [originalCompany, setOriginalCompany] = useState<CompanyInfo>(DEFAULT_COMPANY);
  const [originalZones, setOriginalZones] = useState<ZoneConfig[]>(DEFAULT_ZONES);
  const [originalPolicy, setOriginalPolicy] = useState<CompanyPolicy>(DEFAULT_COMPANY_POLICY);

  const [isSaving, setIsSaving] = useState(false);

  // Load from repos when opened
  useEffect(() => {
    if (!isOpen) return;

    async function load() {
      // Load company name/description
      const companyRow = await repos?.companies.findById(COMPANY_ID).catch(() => null);
      let info: CompanyInfo;
      if (companyRow) {
        let desc = '';
        try {
          // description may be stored in default_model_policy_json or a future config field
          const parsed = JSON.parse(companyRow.default_model_policy_json ?? '{}') as Record<string, unknown>;
          desc = typeof parsed.description === 'string' ? parsed.description : '';
        } catch {
          // ignore
        }
        info = { name: companyRow.name, description: desc };
      } else {
        info = DEFAULT_COMPANY;
      }

      // Load active office layout for zones + policy
      const layoutRow = await repos?.officeLayouts.findActive(COMPANY_ID).catch(() => null);
      let loadedZones: ZoneConfig[] = DEFAULT_ZONES;
      let loadedPolicy: CompanyPolicy = DEFAULT_COMPANY_POLICY;

      if (layoutRow?.layout_json) {
        try {
          const parsed = JSON.parse(layoutRow.layout_json) as Record<string, unknown>;
          if (Array.isArray(parsed.zones)) {
            loadedZones = parsed.zones as ZoneConfig[];
          }
          if (parsed.policy && typeof parsed.policy === 'object') {
            loadedPolicy = {
              defaultModel: (parsed.policy as Record<string, unknown>).defaultModel as string ?? '',
              defaultTemperature: typeof (parsed.policy as Record<string, unknown>).defaultTemperature === 'number'
                ? (parsed.policy as Record<string, unknown>).defaultTemperature as number
                : 0.7,
              defaultMaxTokens: typeof (parsed.policy as Record<string, unknown>).defaultMaxTokens === 'number'
                ? (parsed.policy as Record<string, unknown>).defaultMaxTokens as number
                : 4096,
            };
          }
        } catch {
          // ignore parse errors — use defaults
        }
      }

      setCompany(info);
      setOriginalCompany(info);
      setZones(loadedZones);
      setOriginalZones(loadedZones);
      setPolicy(loadedPolicy);
      setOriginalPolicy(loadedPolicy);
    }

    void load();
  }, [isOpen, repos]);

  const isDirty = useMemo(
    () =>
      JSON.stringify(company) !== JSON.stringify(originalCompany) ||
      JSON.stringify(zones) !== JSON.stringify(originalZones) ||
      JSON.stringify(policy) !== JSON.stringify(originalPolicy),
    [company, originalCompany, zones, originalZones, policy, originalPolicy],
  );

  const updateCompanyName = useCallback((name: string) => {
    setCompany((prev) => (prev ? { ...prev, name } : { name, description: '' }));
  }, []);

  const updateCompanyDescription = useCallback((description: string) => {
    setCompany((prev) => (prev ? { ...prev, description } : { name: '', description }));
  }, []);

  const updateZones = useCallback((z: ZoneConfig[]) => setZones(z), []);
  const updatePolicy = useCallback((p: CompanyPolicy) => setPolicy(p), []);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      // Persist zones + policy into the active office layout
      if (repos) {
        const layoutRow = await repos.officeLayouts.findActive(COMPANY_ID).catch(() => null);
        const layoutJson = JSON.stringify({ zones, policy });

        if (layoutRow) {
          await repos.officeLayouts.update(layoutRow.layout_id, { layout_json: layoutJson });
        } else {
          // Create a new active layout
          const newLayout = await repos.officeLayouts.create({
            layout_id: `layout-${Date.now()}`,
            company_id: COMPANY_ID,
            name: 'Default Layout',
            layout_json: layoutJson,
            is_active: 1,
          });
          await repos.officeLayouts.setActive(COMPANY_ID, newLayout.layout_id);
        }
      }

      // Commit snapshots
      const snapshot = company ?? DEFAULT_COMPANY;
      setOriginalCompany(snapshot);
      setOriginalZones(zones);
      setOriginalPolicy(policy);
    } finally {
      setIsSaving(false);
    }
  }, [repos, company, zones, policy]);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Reset unsaved changes
    setCompany(originalCompany);
    setZones(originalZones);
    setPolicy(originalPolicy);
  }, [originalCompany, originalZones, originalPolicy]);

  return {
    company,
    zones,
    policy,
    updateCompanyName,
    updateCompanyDescription,
    updateZones,
    updatePolicy,
    save,
    isDirty,
    isSaving,
    isOpen,
    open,
    close,
  };
}
