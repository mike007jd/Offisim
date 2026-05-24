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
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { usePublish } from '../../hooks/usePublish.js';
import { loadRegistryAuthToken, saveRegistryAuthToken } from '../../hooks/useRegistryClient.js';
import { showDiscardConfirm } from '../../lib/discard-confirm-toast.js';
import {
  type PublishMeta,
  buildEmployeePackage,
  buildSkillPackage,
} from '../../lib/export-to-manifest.js';
import { draftStatusLabel, draftValidationLabel } from '../../lib/status-display.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context.js';
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
}

const DEFAULT_FORM: PublishFormState = {
  title: '',
  version: '0.1.0',
  summary: '',
  description: '',
  tags: '',
  license: 'MIT',
  riskClass: 'data_asset',
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
  const { repos, skillLoader } = useOffisimRuntimeServices();
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
  }, [selectedSourceId, form.description, form.summary, form.tags, form.title, form.version]);

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
      setStatus(`Downloaded ${bundle.fileName}.`);
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

      const response = await submitDraft({
        kind: bundle.manifest.package.kind,
        title: bundle.manifest.package.title,
        summary: bundle.manifest.package.summary ?? '',
        manifest: bundle.manifest,
        artifactBytes: bundle.archiveBytes,
        artifactSha256: bundle.artifactSha256,
        artifactSizeBytes: bundle.artifactSizeBytes,
        submitMessage: `Submitted from Offisim on ${new Date().toISOString()}`,
      });

      setStatus(`Draft queued for review. Moderation job: ${response.moderation_job_id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to submit draft.');
    } finally {
      setIsPackaging(false);
    }
  }, [buildBundle, submitDraft]);

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
      form.riskClass !== DEFAULT_FORM.riskClass,
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
        <Download data-icon="publish-action" />
        {isPackaging ? 'Building...' : 'Download package'}
      </Button>
      <Button
        type="button"
        disabled={isPackaging || isSubmitting || !selectedSourceId}
        onClick={() => void handleSubmit()}
      >
        <CloudUpload data-icon="publish-action" />
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
        description="Build a package from an employee or a skill, then submit a registry draft with platform-verified artifact bytes."
        footer={footer}
        onRequestClose={handleRequestClose}
        className="publish-dialog-shell"
      >
        <div className="publish-dialog">
          <div className="publish-dialog-form">
            <Field
              label={
                <span className="publish-dialog-label-icon">
                  <KeyRound data-icon="publish-label" />
                  Registry token
                </span>
              }
              htmlFor="publish-auth-token"
              hint={
                creator ? (
                  <span className="text-ok">
                    Publishing as @{creator.handle} ({creator.display_name})
                  </span>
                ) : (
                  'Required when not signed into the platform.'
                )
              }
            >
              <Input
                id="publish-auth-token"
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                placeholder="offisim_your_api_token"
              />
            </Field>

            <div className="publish-dialog-fields">
              {hasMultipleKinds && (
                <Field label="Kind" htmlFor="publish-kind">
                  <Select value={kind} onValueChange={(value) => setKind(value as PublishKind)}>
                    <SelectTrigger id="publish-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="skill">Skill</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field label={sourceLabel} htmlFor="publish-source-asset">
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger id="publish-source-asset">
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
              </Field>

              <div className="publish-dialog-field-grid">
                <Field label="Title" htmlFor="publish-title">
                  <Input
                    id="publish-title"
                    value={form.title}
                    onChange={(event) => updateForm('title', event.target.value)}
                    placeholder="Writer Pro"
                  />
                </Field>
                <Field label="Version" htmlFor="publish-version">
                  <Input
                    id="publish-version"
                    value={form.version}
                    onChange={(event) => updateForm('version', event.target.value)}
                    placeholder="0.1.0"
                  />
                </Field>
                <Field label="Summary" htmlFor="publish-summary">
                  <Input
                    id="publish-summary"
                    value={form.summary}
                    onChange={(event) => updateForm('summary', event.target.value)}
                    placeholder="One-line marketplace summary"
                  />
                </Field>
                <Field label="Tags" htmlFor="publish-tags">
                  <Input
                    id="publish-tags"
                    value={form.tags}
                    onChange={(event) => updateForm('tags', event.target.value)}
                    placeholder="workflow,design,team"
                  />
                </Field>
                <Field label="License" htmlFor="publish-license">
                  <Select
                    value={form.license}
                    onValueChange={(value) => updateForm('license', value)}
                  >
                    <SelectTrigger id="publish-license">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MIT">MIT</SelectItem>
                      <SelectItem value="Apache-2.0">Apache-2.0</SelectItem>
                      <SelectItem value="proprietary">Proprietary</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Risk class" htmlFor="publish-risk-class">
                  <Select
                    value={form.riskClass}
                    onValueChange={(value) =>
                      updateForm('riskClass', value as PublishFormState['riskClass'])
                    }
                  >
                    <SelectTrigger id="publish-risk-class">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="data_asset">Data asset</SelectItem>
                      <SelectItem value="logic_asset">Logic asset</SelectItem>
                      <SelectItem value="privileged_asset">Privileged asset</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Description / README" htmlFor="publish-description">
                <Textarea
                  id="publish-description"
                  className="publish-dialog-description"
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  placeholder="What this package includes, who it is for, and setup notes."
                />
              </Field>

              {(status || error) && <p className="publish-dialog-status">{status ?? error}</p>}
            </div>
          </div>

          <aside className="publish-dialog-preview">
            <div className="publish-dialog-preview-section">
              <p className="publish-dialog-preview-title">Draft preview</p>
              <dl className="publish-dialog-preview-list">
                <DraftRow label="Title" value={form.title || 'Untitled package'} />
                <DraftRow label="Version" value={form.version} />
                <DraftRow
                  label="Tags"
                  value={publishMeta.tags.length > 0 ? publishMeta.tags.join(', ') : 'No tags'}
                />
              </dl>
            </div>

            <div className="publish-dialog-preview-section">
              <p className="publish-dialog-preview-title">Recent drafts</p>
              {isLoading ? (
                <p className="publish-dialog-preview-empty">Loading…</p>
              ) : drafts.length === 0 ? (
                <p className="publish-dialog-preview-empty">No drafts yet.</p>
              ) : (
                <ul className="publish-dialog-drafts">
                  {drafts.slice(0, 5).map((draft) => (
                    <li key={draft.draft_id} className="publish-dialog-draft-row">
                      <p className="publish-dialog-draft-title">
                        {draft.title ?? draft.kind ?? 'Untitled draft'}
                      </p>
                      <p className="publish-dialog-draft-meta">
                        {draftStatusLabel(draft.status)} ·{' '}
                        {draftValidationLabel(draft.validation_state)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </DialogShell>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="publish-dialog-field">
      <label htmlFor={htmlFor} className="publish-dialog-field-label">
        {label}
      </label>
      {children}
      {hint ? <p className="publish-dialog-field-hint">{hint}</p> : null}
    </div>
  );
}

function DraftRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="publish-dialog-preview-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
