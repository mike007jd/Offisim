import { useUiState } from '@/app/ui-state.js';
import { displayRole } from '@/data/adapters.js';
import {
  useCompanies,
  useCompanyEmployees,
  useDeleteCompany,
  useOfficeLayout,
  useProjects,
  useUpdateCompany,
} from '@/data/queries.js';
import type { Company, Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { employeeAvatarUri } from '@/lib/avatar.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { activateCompanyScope } from '@/runtime/activate-company-scope.js';
import { motionPresets } from '@/styles/motion-tokens.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  Archive,
  ArrowRight,
  Building2,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
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
  const deleteCompany = useDeleteCompany();
  const setScope = useUiState((s) => s.setScope);
  const setSurface = useUiState((s) => s.setSurface);
  const activeCompanyId = useUiState((s) => s.companyId);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

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
          } else if (result.missing) {
            toast.error('Company no longer exists.');
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

  function startRename(company: Company) {
    setRenameDraft(company.name);
    setRenamingId(company.id);
  }

  // The surface switch itself is the feedback — no entry toast needed.
  async function enterCompany(company: Company) {
    if (enteringId) return;
    setEnteringId(company.id);
    try {
      await activateCompanyScope({
        companyId: company.id,
        setScope,
        setSurface,
        surface: 'office',
      });
    } catch (error) {
      toast.error('Project workspace unavailable', {
        description: error instanceof Error ? error.message : 'Could not bind a project.',
      });
    } finally {
      setEnteringId(null);
    }
  }

  function leaveDeletedOrArchivedCompany(company: Company) {
    const next = visible.find((candidate) => candidate.id !== company.id) ?? null;
    setPreviewId(next?.id ?? null);
    setConfirmArchiveId(null);
    if (activeCompanyId === company.id) {
      setScope(next?.id ?? '', '');
      setSurface('lifecycle');
    }
  }

  function archiveCompany(company: Company, requireConfirm = true) {
    if (requireConfirm && confirmArchiveId !== company.id) {
      setConfirmArchiveId(company.id);
      return;
    }
    setConfirmArchiveId(null);
    updateCompany.mutate(
      { companyId: company.id, fields: { status: 'archived' } },
      {
        onSuccess: (result) => {
          if (result.persisted) {
            leaveDeletedOrArchivedCompany(company);
            toast.success('Company archived', {
              description: `${company.name} left the active list.`,
            });
          } else if (result.missing) {
            leaveDeletedOrArchivedCompany(company);
            toast.error('Company no longer exists.');
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

  function deleteCompanyNow(company: Company) {
    deleteCompany.mutate(
      { companyId: company.id },
      {
        onSuccess: (result) => {
          if (!result.persisted) {
            if (result.missing) {
              leaveDeletedOrArchivedCompany(company);
              toast.error('Company no longer exists.');
            } else {
              toast.error("Can't save in this build.");
            }
            return;
          }
          leaveDeletedOrArchivedCompany(company);
          if (result.workspaceCleanupError) {
            toast.warning('Company deleted', {
              description: `Database records were cleared. App-local workspace cleanup failed: ${result.workspaceCleanupError}`,
            });
          } else {
            toast.success('Company deleted', {
              description: `${company.name} and its Offisim-managed local history were cleared.`,
            });
          }
        },
        onError: (error) => {
          toast.error('Delete failed', {
            description: safeErrorMessage(error),
          });
        },
      },
    );
  }

  return (
    <motion.div className="off-csp" {...motionPresets.pageFade}>
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
                          onClick={() => startRename(company)}
                        >
                          <Icon icon={Pencil} size="sm" />
                        </button>
                        <CompanyActionsMenu
                          company={company}
                          onRename={() => startRename(company)}
                          onArchive={() => archiveCompany(company, false)}
                          onDelete={() => deleteCompanyNow(company)}
                          busy={deleteCompany.isPending || updateCompany.isPending}
                        />
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
            onEnter={() => void enterCompany(selected)}
            onRename={() => startRename(selected)}
            onArchive={() => archiveCompany(selected)}
            onArchiveImmediate={() => archiveCompany(selected, false)}
            onDelete={() => deleteCompanyNow(selected)}
            busy={deleteCompany.isPending || updateCompany.isPending}
            entering={enteringId === selected.id}
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
  onRename,
  onArchive,
  onArchiveImmediate,
  onDelete,
  busy,
  entering,
}: {
  company: Company;
  confirmArchive: boolean;
  onEnter: () => void;
  onRename: () => void;
  onArchive: () => void;
  onArchiveImmediate: () => void;
  onDelete: () => void;
  busy: boolean;
  entering: boolean;
}) {
  const employeesQuery = useCompanyEmployees(company.id);
  const projectsQuery = useProjects(company.id);
  const layoutQuery = useOfficeLayout(company.id);
  const layoutPending = layoutQuery.isPending;
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
        <button
          type="button"
          className="off-csp-cta off-focusable"
          onClick={onEnter}
          disabled={busy || entering}
        >
          {entering ? 'Opening…' : 'Enter company'}
          <Icon icon={ArrowRight} size="sm" />
        </button>
        <CompanyActionsMenu
          company={company}
          onRename={onRename}
          onArchive={onArchiveImmediate}
          onDelete={onDelete}
          busy={busy}
        />
      </header>

      <div className="off-csp-stats">
        <Stat label="Employees" value={brief.employeeCount} />
        <Stat label="Projects" value={brief.projectCount} />
        {/* Zones shows '—' until the layout query settles, so a loading blink
            never reads as an honest "0 zones". */}
        <Stat label="Zones" value={layoutPending ? '—' : brief.zoneCount} />
      </div>

      <section className="off-csp-prev-card">
        <div className="off-csp-card-h">
          <span>Floor plan</span>
          <span>{layoutPending ? '—' : brief.zoneCount}</span>
        </div>
        <div className="off-csp-prev">
          {layoutPending ? null : <CompanyPortalPreview company={company} brief={brief} />}
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
          Archive
        </button>
        {confirmArchive ? (
          <div className="off-csp-arch-warn">
            Click Archive again to remove {company.name} from the active list.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompanyActionsMenu({
  company,
  onRename,
  onArchive,
  onDelete,
  busy,
}: {
  company: Company;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="iconSm"
            className="off-csp-menu-btn"
            aria-label={`Company actions for ${company.name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Company</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onRename();
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={onArchive}>
            <Archive />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            className="is-danger"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="off-dialog-w-sm" title="Delete company">
          <DialogHeader>
            <DialogTitle>Delete company?</DialogTitle>
            <DialogDescription>
              This removes the company, employees, projects, conversations, local run history, and
              Offisim-managed app-local workspace. External project folders are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setDeleteOpen(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ROSTER_PREVIEW_LIMIT = 5;

function CompanyRoster({ employees }: { employees: Employee[] }) {
  return (
    <div className="off-csp-roster">
      <div className="off-csp-card-h">
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
              {displayRole(employee) ? (
                <span className="off-csp-roster-role">{employee.role}</span>
              ) : null}
            </span>
            {/* Exception-only status: enabled is the norm and gets no marker. */}
            {employee.disabled ? <span className="off-csp-roster-status">Disabled</span> : null}
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="off-csp-stat">
      <div className="off-csp-stat-l">{label}</div>
      <div className="off-csp-stat-v">{value}</div>
    </div>
  );
}
