import { useUiState } from '@/app/ui-state.js';
import {
  useCompanies,
  useCompanyEmployees,
  useOfficeLayout,
  useProjects,
  useUpdateCompany,
} from '@/data/queries.js';
import type { Company, Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { employeeAvatarUri } from '@/lib/avatar.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Archive, ArrowRight, Building2, FolderPlus, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CompanyPortalPreview } from './CompanyPortalPreview.js';
import { companyBrief } from './lifecycle-data.js';

interface CompanySelectionPageProps {
  /** Switch the lifecycle surface into create-wizard mode. */
  onNewCompany: () => void;
}

/** CompanySelectionPage — lifecycle default view: company list · office preview
 *  · company brief. Company edits persist through the repo layer. */
export function CompanySelectionPage({ onNewCompany }: CompanySelectionPageProps) {
  const companiesQuery = useCompanies();
  const updateCompany = useUpdateCompany();
  const setCompany = useUiState((s) => s.setCompany);
  const setSurface = useUiState((s) => s.setSurface);
  const activeCompanyId = useUiState((s) => s.companyId);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const visible = companiesQuery.data ?? [];

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
    const current = visible.find((company) => company.id === id);
    setRenamingId(null);
    if (!next || !current || next === current.name) return;

    updateCompany.mutate(
      { companyId: id, fields: { name: next } },
      {
        onSuccess: (result) => {
          if (result.persisted) {
            toast.success('Company renamed');
          } else {
            toast.error("Can't save in this build.");
          }
        },
        onError: () => {
          toast.error('Rename failed');
        },
      },
    );
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
    setConfirmArchiveId(null);
    setPreviewId(null);
    updateCompany.mutate(
      { companyId: company.id, fields: { status: 'archived' } },
      {
        onSuccess: (result) => {
          if (result.persisted) {
            toast.success('Company archived', {
              description: `${company.name} left the active list.`,
            });
          } else {
            toast.error("Can't save in this build.");
          }
        },
        onError: () => {
          toast.error('Archive failed');
        },
      },
    );
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
          <div className="off-csp-aside-ttl">Companies</div>
          <button type="button" className="off-csp-new off-focusable" onClick={onNewCompany}>
            <Icon icon={FolderPlus} size="sm" />
            New
          </button>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            className="off-csp-empty"
            icon={Building2}
            title="No companies yet"
            description="Create your first AI company to get started."
            action={{ label: 'Create company', onClick: onNewCompany }}
          />
        ) : (
          <div className="off-csp-list">
            {visible.map((company) => {
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
                        maxLength={60}
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
                        <span className="off-csp-row-tpl">{company.templateLabel}</span>
                        {isActive ? (
                          <span className="off-csp-active">
                            <span className="off-csp-active-dot" />
                            Active
                          </span>
                        ) : null}
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
                      </div>
                    ) : null}
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
            confirmArchive={confirmArchiveId === selected.id}
            onEnter={() => enterCompany(selected)}
            onArchive={() => archiveCompany(selected)}
          />
        ) : (
          <div className="off-csp-no-sel">Select a company, or create one.</div>
        )}
      </main>
    </motion.div>
  );
}

function SelectedCompany({
  company,
  confirmArchive,
  onEnter,
  onArchive,
}: {
  company: Company;
  confirmArchive: boolean;
  onEnter: () => void;
  onArchive: () => void;
}) {
  const employeesQuery = useCompanyEmployees(company.id);
  const projectsQuery = useProjects(company.id);
  const layoutQuery = useOfficeLayout(company.id);
  const zoneNames = (layoutQuery.data?.zones ?? []).map((zone) => zone.label);
  const brief = companyBrief(company, {
    employeeCount: employeesQuery.data?.length,
    projectCount: projectsQuery.data?.length,
    zoneNames,
  });
  const roster = employeesQuery.data ?? [];

  return (
    <div className="off-csp-detail">
      {/* Hero: the company identity + the primary "Enter" action lead the column. */}
      <header className="off-csp-hero">
        <div className="off-csp-hero-id">
          <span className="off-csp-brief-ic">
            <Icon icon={Building2} size="md" />
          </span>
          <div className="off-csp-brief-copy">
            <div className="off-csp-brief-nm">{company.name}</div>
            <div className="off-csp-brief-tp">{company.templateLabel}</div>
          </div>
        </div>
        <button type="button" className="off-csp-cta off-focusable" onClick={onEnter}>
          Enter company
          <Icon icon={ArrowRight} size="sm" />
        </button>
      </header>

      <div className="off-csp-stats">
        <Stat label="Employees" value={brief.employeeCount} />
        <Stat label="Projects" value={brief.projectCount} />
        <Stat label="Zones" value={brief.zoneCount} />
      </div>

      <section className="off-csp-prev-wrap">
        <div className="off-csp-label">Floor plan</div>
        <div className="off-csp-prev">
          <CompanyPortalPreview company={company} brief={brief} />
        </div>
      </section>

      <CompanyRoster employees={roster} />

      <div className="off-csp-acts">
        <button
          type="button"
          className={cn('off-csp-arch off-focusable', confirmArchive && 'is-armed')}
          onClick={onArchive}
        >
          <Icon icon={Archive} size="sm" />
          {confirmArchive ? 'Archive (again to confirm)' : 'Archive'}
        </button>
        {confirmArchive ? (
          <div className="off-csp-arch-warn">Remove {company.name} from the active list?</div>
        ) : null}
      </div>
    </div>
  );
}

const ROSTER_PREVIEW_LIMIT = 5;

function CompanyRoster({ employees }: { employees: Employee[] }) {
  return (
    <div className="off-csp-roster">
      <div className="off-csp-roster-h">
        <span>Employees</span>
        <span>{employees.length}</span>
      </div>
      <div className="off-csp-roster-list">
        {employees.slice(0, ROSTER_PREVIEW_LIMIT).map((employee) => (
          <div key={employee.id} className="off-csp-roster-row">
            <img
              className="off-csp-roster-avatar"
              src={employeeAvatarUri(employee.id, employee.appearance)}
              alt=""
              aria-hidden
            />
            <span className="off-csp-roster-copy">
              <span className="off-csp-roster-name">{employee.name}</span>
              <span className="off-csp-roster-role">{employee.role}</span>
            </span>
            <span
              className={cn('off-csp-roster-dot', !employee.disabled && 'is-on')}
              title={employee.disabled ? 'Disabled' : 'Enabled'}
            />
          </div>
        ))}
        {employees.length > ROSTER_PREVIEW_LIMIT ? (
          <div className="off-csp-roster-more">
            +{employees.length - ROSTER_PREVIEW_LIMIT} more — enter the company to see everyone
          </div>
        ) : null}
      </div>
    </div>
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
