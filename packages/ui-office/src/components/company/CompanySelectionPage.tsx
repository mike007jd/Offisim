import type { RuntimeRepositories } from '@offisim/core/browser';
import type { CompanyRow } from '@offisim/core/browser';
import type { PrefabInstanceRow, ZoneRow } from '@offisim/shared-types';
import { Archive, ArrowRight, Building2, FolderPlus, Layers3, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCompanyPreview } from '../../hooks/useCompanyPreview.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
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
  companies: CompanyRow[],
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
  company: CompanyRow | null;
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
      <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.02]">
        <div className="text-center">
          <div className="text-2xl font-semibold text-white">Create your first company</div>
          <p className="mt-3 text-sm text-slate-400">
            Start with a template, then preview the layout here before entering.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full rounded-[28px] border border-white/10 bg-white/[0.02] animate-pulse" />
    );
  }

  if (!bounds || zones.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.02]">
        <div className="text-center">
          <div className="text-xl font-semibold text-white">{company.name}</div>
          <p className="mt-3 text-sm text-slate-400">Layout not customized yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.1),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-4">
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
              stroke="rgba(148,163,184,0.12)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={viewBox.w} height={viewBox.h} rx="28" fill="rgba(2,6,23,0.72)" />
        <rect width={viewBox.w} height={viewBox.h} rx="28" fill="url(#company-preview-grid)" />
        {zones.map((zone) => {
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
            <g key={zone.zone_id}>
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
                fill="rgba(226,232,240,0.65)"
                fontSize="10"
                textAnchor="end"
              >
                {prefabCounts.get(zone.zone_id) ?? 0} assets
              </text>
            </g>
          );
        })}
        {prefabs.map((prefab) => {
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
              key={prefab.instance_id}
              cx={x}
              cy={y}
              r="4.5"
              fill="rgba(255,255,255,0.9)"
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
  onCreateNew,
  onArchiveCompany,
}: CompanySelectionPageProps) {
  const { companies, activeCompanyId } = useCompany();
  const { repos } = useOffisimRuntime();
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

  return (
    <div className="flex h-screen bg-[#07101d] text-white">
      <aside className="w-[320px] shrink-0 border-r border-white/8 bg-black/20 p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Companies</div>
            <div className="mt-2 text-2xl font-semibold text-white">Portal</div>
          </div>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-200 transition hover:border-blue-300/50 hover:bg-blue-500/15"
          >
            <FolderPlus className="h-4 w-4" />
            New
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1">
          {visibleCompanies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-slate-400">
              No companies yet. Create one to start building your workspace.
            </div>
          ) : (
            visibleCompanies.map((company) => {
              const summary = summaries[company.company_id] ?? {
                employeeCount: 0,
                projectCount: 0,
              };
              const isPreview = company.company_id === selectedCompany?.company_id;
              const isActive = company.company_id === activeCompanyId;
              return (
                <button
                  key={company.company_id}
                  type="button"
                  onClick={() => onPreviewCompany(company.company_id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    isPreview
                      ? 'border-blue-400/40 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.2)]'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-white">
                        {company.name}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                        {company.template_label ?? 'Custom'}
                      </div>
                    </div>
                    {isActive && (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {summary.employeeCount}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Layers3 className="h-3.5 w-3.5" />
                      {summary.projectCount}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-6 p-6">
          <section className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                  Preview
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {selectedCompany?.name ?? 'Company Showcase'}
                </div>
              </div>
              {selectedCompany && (
                <button
                  type="button"
                  onClick={() => onEnterCompany(selectedCompany.company_id)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  Enter Company
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="h-[calc(100vh-96px)] min-h-[540px]">
              <CompanyPortalPreview
                company={selectedCompany}
                zones={data?.zones ?? []}
                prefabs={data?.prefabs ?? []}
                loading={loading}
              />
            </div>
          </section>

          <aside className="rounded-[28px] border border-white/10 bg-black/20 p-5">
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Company Brief
            </div>
            {selectedCompany ? (
              <>
                <div className="mt-4 flex items-start gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <Building2 className="h-5 w-5 text-blue-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-white">
                      {selectedCompany.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
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

                <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Updated
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {formatUpdatedAt(selectedCompany.updated_at)}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    Layout Signal
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {data?.zones.length
                      ? `This company currently exposes ${data.zones.length} zones and ${data.prefabs.length} placed assets.`
                      : 'This company does not have a saved office layout yet.'}
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <button
                    type="button"
                    onClick={() => onEnterCompany(selectedCompany.company_id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400"
                  >
                    Enter Company
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchiveCompany(selectedCompany.company_id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.05]"
                  >
                    <Archive className="h-4 w-4" />
                    Archive Company
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-slate-400">
                Pick a company on the left to inspect its layout, or create a new company.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}
