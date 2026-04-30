import type { RuntimeRepositories } from '@offisim/core/browser';
import type { CompanyRow as CompanyRecord } from '@offisim/core/browser';
import type { PrefabInstanceRow, ZoneRow } from '@offisim/shared-types';
import { Archive, ArrowRight, Building2, FolderPlus, Layers3, Pencil, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyPreview } from '../../hooks/useCompanyPreview.js';
import { updateCompanyIdentity } from '../../lib/company-identity.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
import { CompanyCreationWizard } from '../onboarding/CompanyCreationWizard.js';
import { useCompany } from './CompanyContext.js';

interface CompanySelectionPageProps {
  previewCompanyId: string | null;
  onPreviewCompany: (companyId: string) => void;
  onEnterCompany: (companyId: string) => void;
  onCreateNew: () => void;
  onArchiveCompany: (companyId: string) => void;
}

interface CompanySummary {
  employeeCount: number;
  projectCount: number;
}

function formatUpdatedAt(updatedAt: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(updatedAt));
  } catch {
    return updatedAt;
  }
}

function useCompanySummaries(
  repos: RuntimeRepositories | null,
  companies: CompanyRecord[],
): Record<string, CompanySummary> {
  const [summaries, setSummaries] = useState<Record<string, CompanySummary>>({});

  useEffect(() => {
    if (!repos || companies.length === 0) {
      setSummaries({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      companies.map(async (company) => {
        const [employees, projects] = await Promise.all([
          repos.employees.findByCompany(company.company_id),
          repos.projects.findByCompany(company.company_id),
        ]);
        return [
          company.company_id,
          { employeeCount: employees.length, projectCount: projects.length },
        ] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSummaries(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [companies, repos]);

  return summaries;
}

function mapValue(value: number, srcMin: number, srcMax: number, dstMin: number, dstMax: number) {
  if (srcMax - srcMin < 0.001) return (dstMin + dstMax) / 2;
  return ((value - srcMin) / (srcMax - srcMin)) * (dstMax - dstMin) + dstMin;
}

function CompanyPortalPreview({
  company,
  zones,
  prefabs,
  loading,
}: {
  company: CompanyRecord | null;
  zones: ZoneRow[];
  prefabs: PrefabInstanceRow[];
  loading: boolean;
}) {
  const viewBox = { w: 720, h: 480, pad: 40 };
  const bounds = useMemo(() => {
    if (zones.length === 0) return null;
    const minX = Math.min(...zones.map((zone) => zone.cx - zone.w / 2));
    const maxX = Math.max(...zones.map((zone) => zone.cx + zone.w / 2));
    const minZ = Math.min(...zones.map((zone) => zone.cz - zone.d / 2));
    const maxZ = Math.max(...zones.map((zone) => zone.cz + zone.d / 2));
    return { minX, maxX, minZ, maxZ };
  }, [zones]);
  const prefabCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const prefab of prefabs) {
      counts.set(prefab.zone_id, (counts.get(prefab.zone_id) ?? 0) + 1);
    }
    return counts;
  }, [prefabs]);

  if (!company) {
    return (
      <PreviewState
        title="Create your first company"
        description="Start with a template, then preview here."
        dashed
      />
    );
  }

  if (loading) {
    return (
      <div className="h-full animate-pulse rounded-2xl border border-border-default bg-surface-muted" />
    );
  }

  if (!bounds || zones.length === 0) {
    return <PreviewState title={company.name} description="Layout not customized yet." />;
  }

  return (
    <div className="h-full rounded-2xl border border-border-default bg-surface-elevated p-4">
      <svg
        viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{`${company.name} office preview`}</title>
        <defs>
          <pattern id="company-preview-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="var(--color-border-subtle-val)"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={viewBox.w} height={viewBox.h} rx="28" fill="var(--color-surface-muted-val)" />
        <rect width={viewBox.w} height={viewBox.h} rx="28" fill="url(#company-preview-grid)" />
        {zones.map((zone, index) => {
          const x0 = mapValue(
            zone.cx - zone.w / 2,
            bounds.minX,
            bounds.maxX,
            viewBox.pad,
            viewBox.w - viewBox.pad,
          );
          const x1 = mapValue(
            zone.cx + zone.w / 2,
            bounds.minX,
            bounds.maxX,
            viewBox.pad,
            viewBox.w - viewBox.pad,
          );
          const y0 = mapValue(
            zone.cz - zone.d / 2,
            bounds.minZ,
            bounds.maxZ,
            viewBox.pad,
            viewBox.h - viewBox.pad,
          );
          const y1 = mapValue(
            zone.cz + zone.d / 2,
            bounds.minZ,
            bounds.maxZ,
            viewBox.pad,
            viewBox.h - viewBox.pad,
          );
          return (
            <g key={zone.zone_id || `${company.company_id}:zone:${index}`}>
              <rect
                x={x0}
                y={y0}
                width={x1 - x0}
                height={y1 - y0}
                rx="18"
                fill={zone.accent_color}
                fillOpacity="0.12"
                stroke={zone.accent_color}
                strokeOpacity="0.45"
              />
              <text x={x0 + 12} y={y0 + 22} fill={zone.accent_color} fontSize="11" fontWeight="700">
                {zone.label.toUpperCase()}
              </text>
              <text
                x={x1 - 12}
                y={y0 + 22}
                fill="var(--color-text-muted-val)"
                fontSize="10"
                textAnchor="end"
              >
                {prefabCounts.get(zone.zone_id) ?? 0} assets
              </text>
            </g>
          );
        })}
        {prefabs.map((prefab, index) => {
          const x = mapValue(
            prefab.position_x,
            bounds.minX,
            bounds.maxX,
            viewBox.pad,
            viewBox.w - viewBox.pad,
          );
          const y = mapValue(
            prefab.position_y,
            bounds.minZ,
            bounds.maxZ,
            viewBox.pad,
            viewBox.h - viewBox.pad,
          );
          return (
            <circle
              key={
                prefab.instance_id || `${company.company_id}:prefab:${prefab.prefab_id}:${index}`
              }
              cx={x}
              cy={y}
              r="4.5"
              fill="var(--color-surface-elevated-val)"
              opacity="0.88"
            />
          );
        })}
      </svg>
    </div>
  );
}

export function CompanySelectionPage({
  previewCompanyId,
  onPreviewCompany,
  onEnterCompany,
  onArchiveCompany,
}: CompanySelectionPageProps) {
  const { companies, activeCompanyId, refreshCompanies } = useCompany();
  const { repos } = useOffisimRuntime();
  const [renamingCompanyId, setRenamingCompanyId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const visibleCompanies = useMemo(
    () => companies.filter((company) => company.status !== 'archived'),
    [companies],
  );
  const summaries = useCompanySummaries(repos, visibleCompanies);
  const selectedCompany =
    visibleCompanies.find((company) => company.company_id === previewCompanyId) ??
    visibleCompanies.find((company) => company.company_id === activeCompanyId) ??
    visibleCompanies[0] ??
    null;

  const { data, loading } = useCompanyPreview(repos, selectedCompany?.company_id ?? null);
  const selectedSummary = selectedCompany ? summaries[selectedCompany.company_id] : null;
  const [confirmArchiveCompanyId, setConfirmArchiveCompanyId] = useState<string | null>(null);
  const archiveArmed =
    selectedCompany?.company_id != null && confirmArchiveCompanyId === selectedCompany.company_id;

  const handleArchiveClick = () => {
    if (!selectedCompany) return;
    if (confirmArchiveCompanyId === selectedCompany.company_id) {
      onArchiveCompany(selectedCompany.company_id);
      setConfirmArchiveCompanyId(null);
      return;
    }
    setConfirmArchiveCompanyId(selectedCompany.company_id);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-text-primary lg:flex-row">
      {creatingNew && (
        <CompanyCreationWizard
          mode="create-new"
          onComplete={(newCompanyId) => {
            void refreshCompanies();
            setCreatingNew(false);
            onEnterCompany(newCompanyId);
          }}
          onDismiss={() => setCreatingNew(false)}
        />
      )}
      <aside className="flex shrink-0 flex-col border-border-default bg-surface-elevated p-5 lg:w-[320px] lg:border-r">
        <div className="mb-4 flex items-center justify-between lg:mb-5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">Companies</div>
            <div className="mt-1 text-xl font-semibold text-text-primary lg:mt-2 lg:text-2xl">
              Portal
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreatingNew(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-focus bg-accent-muted px-3 text-sm font-medium text-accent-text transition hover:bg-surface-hover"
          >
            <FolderPlus className="h-4 w-4" />
            New
          </button>
        </div>

        <div className="flex max-h-[32vh] flex-col gap-2 overflow-y-auto pr-1 lg:max-h-none lg:space-y-3">
          {visibleCompanies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-surface-muted p-5 text-sm text-text-secondary">
              No companies yet. Create one to start building your workspace.
            </div>
          ) : (
            visibleCompanies.map((company, index) => {
              const summary = summaries[company.company_id] ?? {
                employeeCount: 0,
                projectCount: 0,
              };
              const isPreview = company.company_id === selectedCompany?.company_id;
              const isActive = company.company_id === activeCompanyId;
              const isRenaming = company.company_id === renamingCompanyId;
              return (
                <CompanyRow
                  key={company.company_id || `company:${company.name}:${index}`}
                  company={company}
                  summary={summary}
                  isPreview={isPreview}
                  isActive={isActive}
                  isRenaming={isRenaming}
                  onPreview={() => onPreviewCompany(company.company_id)}
                  onStartRename={() => setRenamingCompanyId(company.company_id)}
                  onCommitRename={async (nextName) => {
                    setRenamingCompanyId(null);
                    if (!repos) return;
                    const trimmed = nextName.trim();
                    if (!trimmed || trimmed === company.name) return;
                    await updateCompanyIdentity(repos, company.company_id, { name: trimmed });
                    refreshCompanies();
                  }}
                  onCancelRename={() => setRenamingCompanyId(null)}
                />
              );
            })
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:p-6">
          <section className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Preview</div>
                <div className="mt-1 text-xl font-semibold text-text-primary lg:mt-2 lg:text-2xl">
                  {selectedCompany?.name ?? 'Company Showcase'}
                </div>
              </div>
            </div>
            <div className="h-[42vh] min-h-[280px] lg:h-[calc(100vh-96px)] lg:min-h-[540px]">
              <CompanyPortalPreview
                company={selectedCompany}
                zones={data?.zones ?? []}
                prefabs={data?.prefabs ?? []}
                loading={loading}
              />
            </div>
          </section>

          <aside className="rounded-2xl border border-border-default bg-surface-elevated p-5">
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              Company Brief
            </div>
            {selectedCompany ? (
              <>
                <div className="mt-4 flex items-start gap-3">
                  <div className="rounded-xl border border-border-default bg-surface-muted p-3">
                    <Building2 className="h-5 w-5 text-accent" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-text-primary">
                      {selectedCompany.name}
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      {selectedCompany.template_label ?? 'Custom company'}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <InfoStat label="Employees" value={String(selectedSummary?.employeeCount ?? 0)} />
                  <InfoStat label="Projects" value={String(selectedSummary?.projectCount ?? 0)} />
                  <InfoStat label="Zones" value={String(data?.zones.length ?? 0)} />
                  <InfoStat label="Assets" value={String(data?.prefabs.length ?? 0)} />
                </div>

                <p className="mt-4 text-[11px] text-text-muted">
                  Updated {formatUpdatedAt(selectedCompany.updated_at)}
                </p>

                <div className="mt-6 space-y-3 pb-2">
                  <button
                    type="button"
                    onClick={() => onEnterCompany(selectedCompany.company_id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-text-inverse transition hover:bg-accent-hover"
                  >
                    Enter Company
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleArchiveClick}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      archiveArmed
                        ? 'border-error/40 bg-error-muted text-error hover:border-error'
                        : 'border-border-default bg-surface-muted text-text-secondary hover:border-border-strong hover:bg-surface-hover'
                    }`}
                  >
                    <Archive className="h-4 w-4" />
                    {archiveArmed ? 'Confirm Archive' : 'Archive Company'}
                  </button>
                  {archiveArmed && (
                    <p className="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-xs leading-relaxed text-error">
                      Archive {selectedCompany.name}? The company will be removed from the active
                      list.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-border-default bg-surface-muted p-5 text-sm text-text-secondary">
                Pick a company on the left to inspect its layout, or create a new company.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

interface CompanyRowProps {
  company: CompanyRecord;
  summary: CompanySummary;
  isPreview: boolean;
  isActive: boolean;
  isRenaming: boolean;
  onPreview: () => void;
  onStartRename: () => void;
  onCommitRename: (nextName: string) => void | Promise<void>;
  onCancelRename: () => void;
}

function CompanyRow({
  company,
  summary,
  isPreview,
  isActive,
  isRenaming,
  onPreview,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: CompanyRowProps) {
  const [draftName, setDraftName] = useState(company.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraftName(company.name);
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [isRenaming, company.name]);

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: card contains nested actions, so a native button would create invalid nested controls
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isRenaming) onPreview();
      }}
      onKeyDown={(e) => {
        if (isRenaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview();
        }
      }}
      className={`group w-full rounded-xl border p-3 text-left transition lg:p-4 ${
        isPreview
          ? 'border-border-focus bg-accent-muted shadow-glow-accent'
          : 'border-border-default bg-surface hover:border-border-strong hover:bg-surface-hover'
      } ${isRenaming ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onCommitRename(draftName);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={() => void onCommitRename(draftName)}
              className="w-full rounded-md border border-border-focus bg-surface px-2 py-1 text-base font-semibold text-text-primary outline-none focus:border-accent"
              aria-label={`Rename ${company.name}`}
            />
          ) : (
            <div className="truncate text-base font-semibold text-text-primary">{company.name}</div>
          )}
          <div className="mt-1 text-xs uppercase tracking-wider text-text-muted">
            {company.template_label ?? 'Custom Layout'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isRenaming && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartRename();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-muted opacity-0 transition hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
              title="Rename company"
              aria-label={`Rename ${company.name}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {isActive && (
            <span className="rounded-full border border-success/30 bg-success-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-success">
              Active
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-text-secondary lg:mt-4">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {summary.employeeCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers3 className="h-3.5 w-3.5" />
          {summary.projectCount}
        </span>
      </div>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-muted p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function PreviewState({
  title,
  description,
  dashed,
}: { title: string; description: string; dashed?: boolean }) {
  return (
    <div
      className={`flex h-full items-center justify-center rounded-2xl border bg-surface-muted ${
        dashed ? 'border-dashed border-border-default' : 'border-border-default'
      }`}
    >
      <div className="px-8 text-center">
        <div className="text-xl font-semibold text-text-primary">{title}</div>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
      </div>
    </div>
  );
}
