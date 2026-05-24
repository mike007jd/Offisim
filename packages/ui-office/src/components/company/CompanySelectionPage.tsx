import type { RuntimeRepositories } from '@offisim/core/browser';
import type { CompanyRow as CompanyRecord } from '@offisim/core/browser';
import type { PrefabInstanceRow, ZoneRow } from '@offisim/shared-types';
import { Badge, Button, Input, cn } from '@offisim/ui-core';
import { Archive, ArrowRight, Building2, FolderPlus, Layers3, Pencil, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyPreview } from '../../hooks/useCompanyPreview.js';
import { updateCompanyIdentity } from '../../lib/company-identity.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context.js';
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
    return <div className="h-full animate-pulse rounded-r-lg border border-line bg-surface-2" />;
  }

  if (!bounds || zones.length === 0) {
    return <PreviewState title={company.name} description="Layout not customized yet." />;
  }

  return (
    <div className="h-full rounded-r-lg border border-line bg-surface-1 p-4">
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
              stroke="var(--line-soft)"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={viewBox.w} height={viewBox.h} rx="28" fill="var(--surface-2)" />
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
              <text x={x1 - 12} y={y0 + 22} fill="var(--ink-3)" fontSize="10" textAnchor="end">
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
              fill="var(--surface-1)"
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
  const { repos } = useOffisimRuntimeServices();
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
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink-1 lg:flex-row">
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
      <aside className="flex shrink-0 flex-col border-line bg-surface-1 p-5 lg:w-80 lg:border-r">
        <div className="mb-4 flex items-center justify-between lg:mb-5">
          <div>
            <div className="text-fs-meta uppercase tracking-wider text-ink-4">Companies</div>
            <div className="mt-1 text-xl font-semibold text-ink-1 lg:mt-2 lg:text-2xl">Portal</div>
          </div>
          <Button type="button" size="sm" onClick={() => setCreatingNew(true)}>
            <FolderPlus className="size-4" aria-hidden="true" />
            New
          </Button>
        </div>

        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 lg:max-h-none lg:gap-3">
          {visibleCompanies.length === 0 ? (
            <div className="rounded-r-lg border border-dashed border-line bg-surface-2 p-5 text-fs-sm text-ink-3">
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
          <section className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-fs-meta uppercase tracking-wider text-ink-4">Preview</div>
                <div className="mt-1 text-xl font-semibold text-ink-1 lg:mt-2 lg:text-2xl">
                  {selectedCompany?.name ?? 'Company Showcase'}
                </div>
              </div>
            </div>
            <div className="h-96 min-h-72 lg:min-h-0 lg:flex-1">
              <CompanyPortalPreview
                company={selectedCompany}
                zones={data?.zones ?? []}
                prefabs={data?.prefabs ?? []}
                loading={loading}
              />
            </div>
          </section>

          <aside className="rounded-r-lg border border-line bg-surface-1 p-5 lg:w-80 lg:shrink-0">
            <div className="text-fs-meta uppercase tracking-wider text-ink-4">Company Brief</div>
            {selectedCompany ? (
              <>
                <div className="mt-4 flex items-start gap-3">
                  <div className="rounded-r-lg border border-line bg-surface-2 p-3">
                    <Building2 className="size-5 text-accent" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-ink-1">
                      {selectedCompany.name}
                    </div>
                    <div className="mt-1 text-fs-sm text-ink-3">
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

                <p className="mt-4 text-fs-meta text-ink-4">
                  Updated {formatUpdatedAt(selectedCompany.updated_at)}
                </p>

                <div className="mt-6 flex flex-col gap-3 pb-2">
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => onEnterCompany(selectedCompany.company_id)}
                    className="w-full"
                  >
                    Enter Company
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant={archiveArmed ? 'destructive' : 'secondary'}
                    size="lg"
                    onClick={handleArchiveClick}
                    className="w-full"
                  >
                    <Archive className="size-4" aria-hidden="true" />
                    {archiveArmed ? 'Confirm Archive' : 'Archive Company'}
                  </Button>
                  {archiveArmed && (
                    <p className="rounded-r-lg border border-danger/30 bg-danger-surface px-4 py-3 text-fs-meta leading-relaxed text-danger">
                      Archive {selectedCompany.name}? The company will be removed from the active
                      list.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-r-lg border border-dashed border-line bg-surface-2 p-5 text-fs-sm text-ink-3">
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
      className={cn(
        'group w-full rounded-r-lg border p-3 text-left transition lg:p-4',
        isPreview
          ? 'border-accent bg-accent-surface shadow-glow-accent'
          : 'border-line bg-bg hover:border-line-strong hover:bg-surface-sunken',
        isRenaming ? 'cursor-default' : 'cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <Input
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
              className="h-9 text-base font-semibold"
              aria-label={`Rename ${company.name}`}
            />
          ) : (
            <div className="truncate text-base font-semibold text-ink-1">{company.name}</div>
          )}
          <div className="mt-1 text-fs-meta uppercase tracking-wider text-ink-4">
            {company.template_label ?? 'Custom Layout'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isRenaming && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onStartRename();
              }}
              className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Rename company"
              aria-label={`Rename ${company.name}`}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          {isActive && (
            <Badge variant="success" size="xs">
              Active
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-fs-meta text-ink-3 lg:mt-4">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden="true" />
          {summary.employeeCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers3 className="size-3.5" aria-hidden="true" />
          {summary.projectCount}
        </span>
      </div>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-r-lg border border-line-soft bg-surface-2 p-4">
      <div className="text-fs-meta uppercase tracking-wider text-ink-4">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink-1">{value}</div>
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
      className={cn(
        'flex h-full items-center justify-center rounded-r-lg border bg-surface-2',
        dashed ? 'border-dashed border-line' : 'border-line',
      )}
    >
      <div className="px-8 text-center">
        <div className="text-xl font-semibold text-ink-1">{title}</div>
        <p className="mt-2 text-fs-sm text-ink-3">{description}</p>
      </div>
    </div>
  );
}
