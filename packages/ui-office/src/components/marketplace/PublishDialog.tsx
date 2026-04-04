import type { CompanyRow, EmployeeRow, SopTemplateRow } from '@offisim/core/browser';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@offisim/ui-core';
import { CloudUpload, Download, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompany } from '../company/CompanyContext.js';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { usePublish } from '../../hooks/usePublish.js';
import {
  loadRegistryAuthToken,
  saveRegistryAuthToken,
} from '../../hooks/useRegistryClient.js';
import {
  buildCompanyPackage,
  buildEmployeePackage,
  buildSopPackage,
  type PublishMeta,
} from '../../lib/export-to-manifest.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';

type PublishSourceKind = 'employee' | 'sop' | 'company_template';

interface PublishDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface PublishFormState {
  readonly title: string;
  readonly version: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: string;
  readonly license: string;
  readonly riskClass: 'data_asset' | 'logic_asset' | 'privileged_asset';
  readonly artifactUrl: string;
}

const DEFAULT_FORM: PublishFormState = {
  title: '',
  version: '0.1.0',
  summary: '',
  description: '',
  tags: '',
  license: 'MIT',
  riskClass: 'data_asset',
  artifactUrl: '',
};

function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blobBytes = bytes as unknown as ArrayBufferView<ArrayBuffer>;
  const url = URL.createObjectURL(new Blob([blobBytes], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PublishDialog({ open, onOpenChange }: PublishDialogProps) {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId, companies } = useCompany();
  const { zones } = useCompanyZones();
  const [authToken, setAuthToken] = useState<string>(loadRegistryAuthToken() ?? '');
  const [sourceKind, setSourceKind] = useState<PublishSourceKind>('employee');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [sops, setSops] = useState<SopTemplateRow[]>([]);
  const [form, setForm] = useState<PublishFormState>(DEFAULT_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [isPackaging, setIsPackaging] = useState(false);
  const { drafts, creator, isLoading, isSubmitting, error, submitDraft } = usePublish(authToken);

  const selectedCompany = useMemo<CompanyRow | null>(
    () => companies.find((company) => company.company_id === activeCompanyId) ?? null,
    [activeCompanyId, companies],
  );

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.employee_id === selectedSourceId) ?? null,
    [employees, selectedSourceId],
  );
  const selectedSop = useMemo(
    () => sops.find((sop) => sop.sop_template_id === selectedSourceId) ?? null,
    [selectedSourceId, sops],
  );

  useEffect(() => {
    saveRegistryAuthToken(authToken);
  }, [authToken]);

  useEffect(() => {
    if (!open || !repos || !activeCompanyId) return;

    let cancelled = false;
    const activeRepos = repos;
    const companyId = activeCompanyId;

    async function loadSources() {
      const [employeeRows, sopRows] = await Promise.all([
        activeRepos.employees.findByCompany(companyId),
        activeRepos.sopTemplates.findByCompany(companyId),
      ]);

      if (cancelled) return;
      setEmployees(employeeRows);
      setSops(sopRows);
    }

    void loadSources();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, open, repos]);

  useEffect(() => {
    if (!open) return;

    if (sourceKind === 'company_template' && selectedCompany) {
      setSelectedSourceId(selectedCompany.company_id);
      setForm((prev) => ({
        ...prev,
        title: prev.title || `${selectedCompany.name} Template`,
        summary: prev.summary || `Reusable company template from ${selectedCompany.name}.`,
        description:
          prev.description ||
          `Snapshot of ${selectedCompany.name} including employees, SOPs, and workspace zones.`,
        tags: prev.tags || 'company,template',
        riskClass: 'logic_asset',
      }));
      return;
    }

    if (sourceKind === 'employee' && employees[0] && !selectedSourceId) {
      const employee = employees[0];
      setSelectedSourceId(employee.employee_id);
      setForm((prev) => ({
        ...prev,
        title: prev.title || employee.name,
        summary: prev.summary || `Employee package for ${employee.name}.`,
        description: prev.description || `Reusable employee configuration for ${employee.name}.`,
        tags: prev.tags || employee.role_slug,
        riskClass: 'data_asset',
      }));
      return;
    }

    if (sourceKind === 'sop' && sops[0] && !selectedSourceId) {
      const sop = sops[0];
      setSelectedSourceId(sop.sop_template_id);
      setForm((prev) => ({
        ...prev,
        title: prev.title || sop.name,
        summary: prev.summary || sop.description || `SOP package for ${sop.name}.`,
        description:
          prev.description || sop.description || `Reusable SOP template for ${sop.name}.`,
        tags: prev.tags || 'sop,workflow',
        riskClass: 'logic_asset',
      }));
    }
  }, [employees, open, selectedCompany, selectedSourceId, sops, sourceKind]);

  useEffect(() => {
    setStatus(null);
  }, [sourceKind, selectedSourceId, form.artifactUrl, form.description, form.summary, form.tags, form.title, form.version]);

  const updateForm = useCallback(
    <K extends keyof PublishFormState>(key: K, value: PublishFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const publishMeta = useMemo<PublishMeta>(
    () => ({
      title: form.title.trim(),
      summary: form.summary.trim(),
      description: form.description.trim(),
      version: form.version.trim(),
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      license: form.license,
      riskClass: form.riskClass,
      creatorHandle: creator?.handle,
      creatorDisplayName: creator?.display_name,
      artifactUrl: form.artifactUrl.trim() || undefined,
    }),
    [creator?.display_name, creator?.handle, form],
  );

  const buildBundle = useCallback(async () => {
    if (sourceKind === 'employee' && selectedEmployee) {
      return buildEmployeePackage(selectedEmployee, publishMeta);
    }
    if (sourceKind === 'sop' && selectedSop) {
      return buildSopPackage(selectedSop, publishMeta);
    }
    if (sourceKind === 'company_template' && selectedCompany) {
      return buildCompanyPackage(selectedCompany, employees, sops, zones, publishMeta);
    }
    throw new Error('Select a source asset before publishing.');
  }, [employees, publishMeta, selectedCompany, selectedEmployee, selectedSop, sops, sourceKind, zones]);

  const handleDownload = useCallback(async () => {
    setIsPackaging(true);
    setStatus(null);
    try {
      const bundle = await buildBundle();
      downloadBytes(bundle.fileName, bundle.archiveBytes);
      setStatus(`Downloaded ${bundle.fileName}. Upload it to GitHub Releases, then paste the URL here.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to build package archive.');
    } finally {
      setIsPackaging(false);
    }
  }, [buildBundle]);

  const handleSubmit = useCallback(async () => {
    setIsPackaging(true);
    setStatus(null);

    try {
      const bundle = await buildBundle();
      if (!publishMeta.artifactUrl) {
        throw new Error('Artifact URL is required before submitting the draft.');
      }

      const response = await submitDraft({
        kind: bundle.manifest.package.kind,
        title: bundle.manifest.package.title,
        summary: bundle.manifest.package.summary ?? '',
        manifest: bundle.manifest,
        artifactUrl: publishMeta.artifactUrl,
        submitMessage: `Submitted from Offisim on ${new Date().toISOString()}`,
      });

      setStatus(`Draft queued for review. Moderation job: ${response.moderation_job_id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to submit draft.');
    } finally {
      setIsPackaging(false);
    }
  }, [buildBundle, publishMeta.artifactUrl, submitDraft]);

  const sourceOptions = useMemo(() => {
    if (sourceKind === 'employee') {
      return employees.map((employee) => ({
        value: employee.employee_id,
        label: `${employee.name} (${employee.role_slug})`,
      }));
    }

    if (sourceKind === 'sop') {
      return sops.map((sop) => ({
        value: sop.sop_template_id,
        label: sop.name,
      }));
    }

    return selectedCompany
      ? [{ value: selectedCompany.company_id, label: `${selectedCompany.name} (current company)` }]
      : [];
  }, [employees, selectedCompany, sops, sourceKind]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-white/10 bg-slate-950/95">
        <DialogHeader>
          <DialogTitle>Publish To Market</DialogTitle>
          <DialogDescription>
            Build a package from your current Offisim data, download the archive, and submit a
            registry draft that points at an external artifact URL.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="h-4 w-4 text-cyan-300" />
                Registry Auth
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Use an `offisim_...` API token if you are not signed into the platform in this
                browser.
              </p>
              <Input
                className="mt-3"
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                placeholder="offisim_your_api_token"
              />
              {creator ? (
                <p className="mt-2 text-xs text-emerald-300">
                  Publishing as @{creator.handle} ({creator.display_name})
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Creator profile not detected yet. The current token or session must belong to a
                  registered creator.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-300">Source kind</label>
                  <Select
                    value={sourceKind}
                    onValueChange={(value) => {
                      setSourceKind(value as PublishSourceKind);
                      setSelectedSourceId('');
                    }}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Choose what to publish" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="sop">SOP</SelectItem>
                      <SelectItem value="company_template">Company template</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Source asset</label>
                  <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select a local asset" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-300">Title</label>
                  <Input
                    className="mt-2"
                    value={form.title}
                    onChange={(event) => updateForm('title', event.target.value)}
                    placeholder="Writer Pro"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300">Version</label>
                  <Input
                    className="mt-2"
                    value={form.version}
                    onChange={(event) => updateForm('version', event.target.value)}
                    placeholder="0.1.0"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300">Summary</label>
                  <Input
                    className="mt-2"
                    value={form.summary}
                    onChange={(event) => updateForm('summary', event.target.value)}
                    placeholder="Short one-line marketplace summary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300">Tags</label>
                  <Input
                    className="mt-2"
                    value={form.tags}
                    onChange={(event) => updateForm('tags', event.target.value)}
                    placeholder="workflow,design,team"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300">License</label>
                  <Select
                    value={form.license}
                    onValueChange={(value) => updateForm('license', value)}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MIT">MIT</SelectItem>
                      <SelectItem value="Apache-2.0">Apache-2.0</SelectItem>
                      <SelectItem value="proprietary">Proprietary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300">Risk class</label>
                  <Select
                    value={form.riskClass}
                    onValueChange={(value) => updateForm('riskClass', value as PublishFormState['riskClass'])}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="data_asset">Data asset</SelectItem>
                      <SelectItem value="logic_asset">Logic asset</SelectItem>
                      <SelectItem value="privileged_asset">Privileged asset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium text-slate-300">Description / README</label>
                <Textarea
                  className="mt-2 min-h-32"
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  placeholder="Explain what this package includes, who it is for, and any setup notes."
                />
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium text-slate-300">Artifact URL</label>
                <Input
                  className="mt-2"
                  value={form.artifactUrl}
                  onChange={(event) => updateForm('artifactUrl', event.target.value)}
                  placeholder="https://github.com/owner/repo/releases/download/v0.1.0/package.offisimpkg"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Use the download URL for the package archive you uploaded to GitHub Releases or
                  another stable host.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPackaging || !selectedSourceId}
                  onClick={() => void handleDownload()}
                >
                  <Download className="h-4 w-4" />
                  {isPackaging ? 'Building…' : 'Download package'}
                </Button>
                <Button
                  type="button"
                  disabled={isPackaging || isSubmitting || !selectedSourceId}
                  onClick={() => void handleSubmit()}
                >
                  <CloudUpload className="h-4 w-4" />
                  {isSubmitting ? 'Submitting…' : 'Submit draft'}
                </Button>
              </div>

              {(status || error) && (
                <p className="mt-3 text-xs leading-relaxed text-slate-300">{status ?? error}</p>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-white">Current draft preview</p>
              <dl className="mt-3 space-y-2 text-xs text-slate-400">
                <div>
                  <dt className="text-slate-500">Kind</dt>
                  <dd className="text-slate-200">{sourceKind}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Title</dt>
                  <dd className="text-slate-200">{form.title || 'Untitled package'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Version</dt>
                  <dd className="text-slate-200">{form.version}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tags</dt>
                  <dd className="text-slate-200">
                    {publishMeta.tags.length > 0 ? publishMeta.tags.join(', ') : 'No tags'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-semibold text-white">Recent drafts</p>
              {isLoading ? (
                <p className="mt-3 text-xs text-slate-500">Loading drafts…</p>
              ) : drafts.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  No publish drafts yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {drafts.slice(0, 5).map((draft) => (
                    <div
                      key={draft.draft_id}
                      className="rounded-xl border border-white/10 bg-slate-950/70 p-3"
                    >
                      <p className="text-xs font-medium text-slate-100">
                        {draft.title ?? draft.kind ?? 'Untitled draft'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {draft.status} · validation {draft.validation_state}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
