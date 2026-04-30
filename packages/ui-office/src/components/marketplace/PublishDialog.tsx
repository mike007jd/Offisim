import type { EmployeeRow } from '@offisim/core/browser';
import { serializeSkillMd } from '@offisim/core/browser';
import type { SkillMetadata } from '@offisim/shared-types';
import {
  Button,
  DialogShell,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToastBanner,
  useToasts,
} from '@offisim/ui-core';
import { CloudUpload, Download, KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePublish } from '../../hooks/usePublish.js';
import { loadRegistryAuthToken, saveRegistryAuthToken } from '../../hooks/useRegistryClient.js';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast.js';
import {
  type PublishMeta,
  buildEmployeePackage,
  buildSkillPackage,
} from '../../lib/export-to-manifest.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
import { useCompany } from '../company/CompanyContext.js';

type PublishKind = 'employee' | 'skill';

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
  const { repos, skillLoader } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { toasts, addToast, dismissToast } = useToasts();
  const [authToken, setAuthToken] = useState<string>(loadRegistryAuthToken() ?? '');
  const [kind, setKind] = useState<PublishKind>('employee');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [form, setForm] = useState<PublishFormState>(DEFAULT_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [isPackaging, setIsPackaging] = useState(false);
  const effectiveToken = authToken.trim() || null;
  const { drafts, creator, isLoading, isSubmitting, error, submitDraft } =
    usePublish(effectiveToken);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.employee_id === selectedSourceId) ?? null,
    [employees, selectedSourceId],
  );
  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSourceId) ?? null,
    [skills, selectedSourceId],
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
      const employeeRows = await activeRepos.employees.findByCompany(companyId);
      if (cancelled) return;
      setEmployees(employeeRows);

      const skillRepo = activeRepos.skills;
      if (!skillRepo) {
        setSkills([]);
        return;
      }
      try {
        const all = await skillRepo.listByCompany(companyId);
        if (cancelled) return;
        setSkills(
          all.map((row) => ({
            id: row.skill_id,
            slug: row.slug,
            name: row.name,
            description: row.description,
            scope: row.scope,
            version: row.version,
          })),
        );
      } catch {
        if (!cancelled) setSkills([]);
      }
    }

    void loadSources();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, open, repos]);

  // Reset source selection + form defaults whenever kind flips so the
  // employee-shape defaults don't leak into a skill publish.
  useEffect(() => {
    void kind;
    if (!open) return;
    setSelectedSourceId('');
  }, [kind, open]);

  useEffect(() => {
    if (!open) return;
    if (selectedSourceId) return;

    if (kind === 'employee' && employees[0]) {
      const employee = employees[0];
      setSelectedSourceId(employee.employee_id);
      setForm((prev) => ({
        ...prev,
        title: employee.name,
        summary: `Employee package for ${employee.name}.`,
        description: `Reusable employee configuration for ${employee.name}.`,
        tags: employee.role_slug,
        riskClass: 'data_asset',
      }));
    } else if (kind === 'skill' && skills[0]) {
      const skill = skills[0];
      setSelectedSourceId(skill.id);
      setForm((prev) => ({
        ...prev,
        title: skill.name,
        summary: skill.description.slice(0, 160),
        description: skill.description,
        tags: 'skill',
        riskClass: 'data_asset',
      }));
    }
  }, [employees, kind, open, selectedSourceId, skills]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional triggers — reset status when any form field changes
  useEffect(() => {
    setStatus(null);
  }, [
    selectedSourceId,
    form.artifactUrl,
    form.description,
    form.summary,
    form.tags,
    form.title,
    form.version,
  ]);

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
    if (kind === 'skill') {
      if (!selectedSkill) {
        throw new Error('Select a skill before publishing.');
      }
      if (!skillLoader) {
        throw new Error('Skill runtime is not ready — wait for vault activation and retry.');
      }
      const body = await skillLoader.loadSkillBody(selectedSkill.id);
      const skillMd = serializeSkillMd({
        name: selectedSkill.slug,
        description: selectedSkill.description,
        version: selectedSkill.version,
        body,
      });
      return buildSkillPackage({ skill: selectedSkill, skillMd }, publishMeta);
    }
    if (!selectedEmployee) {
      throw new Error('Select an employee before publishing.');
    }
    return buildEmployeePackage(selectedEmployee, publishMeta);
  }, [kind, publishMeta, selectedEmployee, selectedSkill, skillLoader]);

  const handleDownload = useCallback(async () => {
    setIsPackaging(true);
    setStatus(null);
    try {
      const bundle = await buildBundle();
      downloadBytes(bundle.fileName, bundle.archiveBytes);
      setStatus(
        `Downloaded ${bundle.fileName}. Upload it to GitHub Releases, then paste the URL here.`,
      );
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
    if (kind === 'skill') {
      return skills.map((skill) => ({
        value: skill.id,
        label: `${skill.name} — ${skill.scope === 'employee' ? 'personal' : 'global'}`,
      }));
    }
    return employees.map((employee) => ({
      value: employee.employee_id,
      label: `${employee.name} (${employee.role_slug})`,
    }));
  }, [employees, kind, skills]);

  const sourceLabel = kind === 'skill' ? 'Skill' : 'Employee';
  const sourcePlaceholder = kind === 'skill' ? 'Select a skill' : 'Select an employee';
  const hasMultipleKinds = employees.length > 0 && skills.length > 0;
  const isDirty = useMemo(
    () =>
      selectedSourceId !== '' ||
      kind !== 'employee' ||
      form.title !== DEFAULT_FORM.title ||
      form.version !== DEFAULT_FORM.version ||
      form.summary !== DEFAULT_FORM.summary ||
      form.description !== DEFAULT_FORM.description ||
      form.tags !== DEFAULT_FORM.tags ||
      form.license !== DEFAULT_FORM.license ||
      form.riskClass !== DEFAULT_FORM.riskClass ||
      form.artifactUrl !== DEFAULT_FORM.artifactUrl,
    [form, kind, selectedSourceId],
  );

  const resetDraft = useCallback(() => {
    setKind('employee');
    setSelectedSourceId('');
    setForm(DEFAULT_FORM);
    setStatus(null);
  }, []);

  const discardAndClose = useCallback(() => {
    resetDraft();
    onOpenChange(false);
  }, [onOpenChange, resetDraft]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
  }, [addToast, discardAndClose, isDirty, onOpenChange]);

  const handleRequestClose = useCallback(() => {
    if (!isDirty) return undefined;
    showDiscardConfirm(addToast, { onDiscard: discardAndClose });
    return false;
  }, [addToast, discardAndClose, isDirty]);

  const footer = (
    <>
      <Button type="button" variant="outline" disabled={isPackaging} onClick={requestClose}>
        Cancel
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={isPackaging || !selectedSourceId}
        onClick={() => void handleDownload()}
      >
        <Download className="h-4 w-4" />
        {isPackaging ? 'Building...' : 'Download package'}
      </Button>
      <Button
        type="button"
        disabled={isPackaging || isSubmitting || !selectedSourceId}
        onClick={() => void handleSubmit()}
      >
        <CloudUpload className="h-4 w-4" />
        {isSubmitting ? 'Submitting...' : 'Submit draft'}
      </Button>
    </>
  );

  return (
    <>
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        title="Publish To Market"
        description="Build a package from an employee or a skill, download the archive, and submit a registry draft that points at an external artifact URL."
        footer={footer}
        onRequestClose={handleRequestClose}
        className="border-white/10 bg-slate-950/95"
      >
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
              {hasMultipleKinds && (
                <div className="mb-4">
                  <label htmlFor="publish-kind" className="text-xs font-medium text-slate-300">
                    Kind
                  </label>
                  <Select value={kind} onValueChange={(value) => setKind(value as PublishKind)}>
                    <SelectTrigger id="publish-kind" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="skill">Skill</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label
                  htmlFor="publish-source-asset"
                  className="text-xs font-medium text-slate-300"
                >
                  {sourceLabel}
                </label>
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger id="publish-source-asset" className="mt-2">
                    <SelectValue placeholder={sourcePlaceholder} />
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

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="publish-title" className="text-xs font-medium text-slate-300">
                    Title
                  </label>
                  <Input
                    id="publish-title"
                    className="mt-2"
                    value={form.title}
                    onChange={(event) => updateForm('title', event.target.value)}
                    placeholder="Writer Pro"
                  />
                </div>
                <div>
                  <label htmlFor="publish-version" className="text-xs font-medium text-slate-300">
                    Version
                  </label>
                  <Input
                    id="publish-version"
                    className="mt-2"
                    value={form.version}
                    onChange={(event) => updateForm('version', event.target.value)}
                    placeholder="0.1.0"
                  />
                </div>
                <div>
                  <label htmlFor="publish-summary" className="text-xs font-medium text-slate-300">
                    Summary
                  </label>
                  <Input
                    id="publish-summary"
                    className="mt-2"
                    value={form.summary}
                    onChange={(event) => updateForm('summary', event.target.value)}
                    placeholder="Short one-line marketplace summary"
                  />
                </div>
                <div>
                  <label htmlFor="publish-tags" className="text-xs font-medium text-slate-300">
                    Tags
                  </label>
                  <Input
                    id="publish-tags"
                    className="mt-2"
                    value={form.tags}
                    onChange={(event) => updateForm('tags', event.target.value)}
                    placeholder="workflow,design,team"
                  />
                </div>
                <div>
                  <label htmlFor="publish-license" className="text-xs font-medium text-slate-300">
                    License
                  </label>
                  <Select
                    value={form.license}
                    onValueChange={(value) => updateForm('license', value)}
                  >
                    <SelectTrigger id="publish-license" className="mt-2">
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
                  <label
                    htmlFor="publish-risk-class"
                    className="text-xs font-medium text-slate-300"
                  >
                    Risk class
                  </label>
                  <Select
                    value={form.riskClass}
                    onValueChange={(value) =>
                      updateForm('riskClass', value as PublishFormState['riskClass'])
                    }
                  >
                    <SelectTrigger id="publish-risk-class" className="mt-2">
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
                <label htmlFor="publish-description" className="text-xs font-medium text-slate-300">
                  Description / README
                </label>
                <Textarea
                  id="publish-description"
                  className="mt-2 min-h-32"
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  placeholder="Explain what this package includes, who it is for, and any setup notes."
                />
              </div>

              <div className="mt-4">
                <label
                  htmlFor="publish-artifact-url"
                  className="text-xs font-medium text-slate-300"
                >
                  Artifact URL
                </label>
                <Input
                  id="publish-artifact-url"
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
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
