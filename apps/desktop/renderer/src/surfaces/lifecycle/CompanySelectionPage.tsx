import { useUiState } from '@/app/ui-state.js';
import { useCompanies, useEmployees, useProjects } from '@/data/queries.js';
import type { Company } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Archive, ArrowRight, Building2, FolderPlus, Layers, Pencil, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CompanyPortalPreview } from './CompanyPortalPreview.js';
import { companyBrief } from './lifecycle-data.js';

interface CompanySelectionPageProps {
  /** Switch the lifecycle surface into create-wizard mode. */
  onNewCompany: () => void;
}

/** CompanySelectionPage — the lifecycle default view. Full-screen three-region
 *  portal: company list (rename + active + counts) · SVG office preview ·
 *  Company Brief (2×2 stats + Enter / Archive). Rename + archive are local
 *  state only (no backend); Enter switches the active company and opens Office. */
export function CompanySelectionPage({ onNewCompany }: CompanySelectionPageProps) {
  const companiesQuery = useCompanies();
  const setCompany = useUiState((s) => s.setCompany);
  const setSurface = useUiState((s) => s.setSurface);
  const activeCompanyId = useUiState((s) => s.companyId);

  // Local-only lifecycle state: renamed names + archived ids overlay the query
  // result (portal rename/archive are front-end-only per task scope).
  const [renamedNames, setRenamedNames] = useState<Record<string, string>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const allCompanies = companiesQuery.data ?? [];
  const visible = useMemo(
    () =>
      allCompanies
        .filter((c) => !archivedIds.has(c.id))
        .map((c) => (renamedNames[c.id] ? { ...c, name: renamedNames[c.id] as string } : c)),
    [allCompanies, archivedIds, renamedNames],
  );

  // Selection precedence: explicit preview → active → first visible.
  const selectedId =
    (previewId && visible.some((c) => c.id === previewId) ? previewId : null) ??
    (visible.some((c) => c.id === activeCompanyId) ? activeCompanyId : null) ??
    visible[0]?.id ??
    null;
  const selected = visible.find((c) => c.id === selectedId) ?? null;

  // Reset the 2-step archive arm whenever the selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change only
  useEffect(() => {
    setConfirmArchiveId(null);
  }, [selectedId]);

  function commitRename(id: string) {
    const next = renameDraft.trim();
    if (next) setRenamedNames((m) => ({ ...m, [id]: next }));
    setRenamingId(null);
  }

  function enterCompany(company: Company) {
    setCompany(company.id);
    setSurface('office');
    toast.success(`Entered ${company.name}`);
  }

  function archiveCompany(company: Company) {
    if (confirmArchiveId !== company.id) {
      setConfirmArchiveId(company.id);
      return;
    }
    setArchivedIds((s) => new Set(s).add(company.id));
    setConfirmArchiveId(null);
    setPreviewId(null);
    toast.success('Company archived', { description: `${company.name} left the active list.` });
  }

  return (
    <motion.div
      className="off-csp"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <aside className="off-csp-aside">
        <div className="off-csp-aside-h">
          <div>
            <div className="off-csp-label">Companies</div>
            <div className="off-csp-aside-ttl">Portal</div>
          </div>
          <button type="button" className="off-csp-new off-focusable" onClick={onNewCompany}>
            <Icon icon={FolderPlus} size="sm" />
            New
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="off-csp-empty">No companies yet. Create one to start building.</div>
        ) : (
          <div className="off-csp-list">
            {visible.map((company) => {
              const brief = companyBrief(company);
              const isSel = company.id === selectedId;
              const isActive = company.id === activeCompanyId;
              const isRenaming = renamingId === company.id;
              return (
                <div key={company.id} className={cn('off-csp-row', isSel && 'is-sel')}>
                  <div className="off-csp-row-top">
                    {isRenaming ? (
                      <input
                        className="off-csp-rename"
                        value={renameDraft}
                        aria-label={`Rename ${company.name}`}
                        // biome-ignore lint/a11y/noAutofocus: rename input must take focus on open
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(company.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => commitRename(company.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="off-csp-row-select off-focusable"
                        onClick={() => setPreviewId(company.id)}
                      >
                        <span className="off-csp-row-name">{company.name}</span>
                        <span className="off-csp-row-tpl">{brief.templateLabel}</span>
                      </button>
                    )}
                    {!isRenaming ? (
                      <div className="off-csp-row-acts">
                        <button
                          type="button"
                          aria-label={`Rename ${company.name}`}
                          className="off-csp-pencil off-focusable"
                          onClick={() => {
                            setRenameDraft(company.name);
                            setRenamingId(company.id);
                          }}
                        >
                          <Icon icon={Pencil} size="sm" />
                        </button>
                        {isActive ? (
                          <span className="off-csp-active">
                            <span className="off-csp-active-dot" />
                            Active
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="off-csp-row-stats">
                    <span>
                      <Icon icon={Users} size="sm" />
                      {brief.employeeCount}
                    </span>
                    <span>
                      <Icon icon={Layers} size="sm" />
                      {brief.projectCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <main className="off-csp-main">
        {selected ? (
          <SelectedCompany
            company={selected}
            isActive={selected.id === activeCompanyId}
            confirmArchive={confirmArchiveId === selected.id}
            onEnter={() => enterCompany(selected)}
            onArchive={() => archiveCompany(selected)}
          />
        ) : (
          <div className="off-csp-no-sel">
            Pick a company on the left to inspect its layout, or create a new company.
          </div>
        )}
      </main>
    </motion.div>
  );
}

function SelectedCompany({
  company,
  isActive,
  confirmArchive,
  onEnter,
  onArchive,
}: {
  company: Company;
  isActive: boolean;
  confirmArchive: boolean;
  onEnter: () => void;
  onArchive: () => void;
}) {
  // Live counts for the active company; portal-derived counts for the rest.
  const employeesQuery = useEmployees();
  const projectsQuery = useProjects(company.id);
  const brief = companyBrief(company, {
    employeeCount: isActive ? employeesQuery.data?.length : undefined,
    projectCount: projectsQuery.data?.length,
  });

  return (
    <>
      <section className="off-csp-prev-wrap">
        <div className="off-csp-prev-h">
          <div className="off-csp-label">Preview</div>
          <div className="off-csp-prev-ttl">{company.name}</div>
        </div>
        <div className="off-csp-prev">
          <CompanyPortalPreview company={company} brief={brief} />
        </div>
      </section>

      <aside className="off-csp-brief">
        <div className="off-csp-label">Company Brief</div>
        <div className="off-csp-brief-id">
          <span className="off-csp-brief-ic">
            <Icon icon={Building2} size="md" />
          </span>
          <div className="off-csp-brief-copy">
            <div className="off-csp-brief-nm">{company.name}</div>
            <div className="off-csp-brief-tp">{brief.templateLabel}</div>
          </div>
        </div>
        <div className="off-csp-stats">
          <Stat label="Employees" value={brief.employeeCount} />
          <Stat label="Projects" value={brief.projectCount} />
          <Stat label="Zones" value={brief.zoneCount} />
          <Stat label="Assets" value={brief.assetCount} />
        </div>
        <div className="off-csp-updated">{brief.updatedLabel}</div>
        <div className="off-csp-acts">
          <button type="button" className="off-csp-cta off-focusable" onClick={onEnter}>
            Enter Company
            <Icon icon={ArrowRight} size="sm" />
          </button>
          <button
            type="button"
            className={cn('off-csp-arch off-focusable', confirmArchive && 'is-armed')}
            onClick={onArchive}
          >
            <Icon icon={Archive} size="sm" />
            {confirmArchive ? 'Confirm Archive' : 'Archive Company'}
          </button>
          {confirmArchive ? (
            <div className="off-csp-arch-warn">
              Archive {company.name}? The company will be removed from the active list.
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="off-csp-stat">
      <div className="off-csp-stat-l">{label}</div>
      <div className="off-csp-stat-v">{value}</div>
    </div>
  );
}
