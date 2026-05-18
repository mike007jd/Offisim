import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ScrollArea,
  cn,
  useFocusTrap,
  useRegisterModal,
  useTopmostEscape,
} from '@offisim/ui-core';
import { AlertTriangle, Bell, FileOutput, Trash2, X, XCircle } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useCostDashboard } from '../../hooks/useCostDashboard';
import { useDeliverables } from '../../hooks/useDeliverables';
import { type TrackedError, useErrorTracking } from '../../hooks/useErrorTracking';
import { type Notification, useNotifications } from '../../hooks/useNotifications';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { formatTimestamp, truncate } from '../../lib/format-time';
import { useAgentStates } from '../../runtime/use-agent-states';
import { CompanyStatusCard } from './CompanyStatusCard';
import { CostByModelCard } from './CostByModelCard';
import { CostOverviewCard } from './CostOverviewCard';
import { ExecutionSummaryCard } from './ExecutionSummaryCard';
import { FileChangesCard } from './FileChangesCard';
import { InsightsCard } from './InsightsCard';
import { RecentActivityCard } from './RecentActivityCard';
import { TaskQueueCard } from './TaskQueueCard';
import { TeamHealthCard } from './TeamHealthCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DashboardOverlayProps {
  open: boolean;
  onClose: () => void;
  activeThreadId?: string | null;
}

// ---------------------------------------------------------------------------
// Sub-cards
// ---------------------------------------------------------------------------

function NotificationsCard({
  notifications,
  unreadCount,
  onMarkRead,
  onDismiss,
  onClearAll,
}: {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}) {
  const levelDotClass: Record<Notification['level'], string> = {
    info: 'bg-info',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-text-muted">
            <Bell className="h-4 w-4" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="error" className="text-caption">
                {unreadCount}
              </Badge>
            )}
          </CardTitle>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onClearAll}
              title="Clear all"
              aria-label="Clear all notifications"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <p className="text-xs text-text-muted">No notifications</p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="flex flex-col gap-1">
              {notifications.slice(0, 20).map((n) => (
                <div
                  key={n.notificationId}
                  className={cn(
                    'flex items-start gap-2 rounded p-1.5 transition-colors hover:bg-surface-hover',
                    n.read && 'opacity-50',
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto flex-1 cursor-pointer appearance-none items-start justify-start gap-2 rounded border-0 bg-transparent p-0 text-left"
                    onClick={() => !n.read && onMarkRead(n.notificationId)}
                  >
                    <div
                      className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', levelDotClass[n.level])}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs leading-tight text-text-secondary">
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-3 text-caption leading-tight text-text-muted">
                        {n.message}
                      </p>
                    </div>
                    <span className="shrink-0 text-caption text-text-muted">
                      {formatTimestamp(n.timestamp)}
                    </span>
                  </Button>
                  {n.dismissable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-text-muted hover:text-text-secondary"
                      aria-label="Dismiss notification"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(n.notificationId);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorHistoryCard({ errors }: { errors: TrackedError[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-text-muted">
          <AlertTriangle className="h-4 w-4" />
          Error History
          {errors.length > 0 && (
            <Badge variant="error" className="text-caption">
              {errors.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <p className="text-xs text-text-muted">No errors recorded</p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="flex flex-col gap-1.5">
              {errors
                .slice()
                .reverse()
                .slice(0, 20)
                .map((err, i) => (
                  <div
                    key={`${err.errorCode}-${err.timestamp}-${i}`}
                    className="rounded border border-border-subtle bg-surface-muted/40 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          err.recoverable ? 'text-warning' : 'text-error',
                        )}
                      />
                      <span className="truncate font-mono text-xs text-text-secondary">
                        {err.errorCode}
                      </span>
                      <span className="ml-auto shrink-0 text-caption text-text-muted">
                        {formatTimestamp(err.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-caption text-text-secondary">
                      {err.message}
                    </p>
                    {err.nodeName && (
                      <span className="mt-0.5 block text-caption text-text-muted">
                        node: {err.nodeName}
                        {err.employeeId ? ` | employee: ${err.employeeId}` : ''}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function OutputsCard() {
  const deliverables = useDeliverables();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-text-muted">
          <FileOutput className="h-4 w-4" />
          Recent Outputs
          {deliverables.length > 0 && (
            <Badge variant="info" className="text-caption">
              {deliverables.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deliverables.length === 0 ? (
          <p className="text-xs text-text-muted">
            No outputs yet. Deliverables will appear after tasks complete.
          </p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="flex flex-col gap-1.5">
              {deliverables
                .slice()
                .reverse()
                .slice(0, 10)
                .map((d) => (
                  <div
                    key={d.id}
                    className="rounded border border-border-subtle bg-surface-muted/40 p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs text-text-primary">{d.title}</span>
                      <span className="ml-2 shrink-0 text-caption text-text-muted">
                        {formatTimestamp(d.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-caption text-text-muted">
                      {truncate(d.content, 120)}
                    </p>
                    {d.contributingEmployees.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.contributingEmployees.map((emp) => (
                          <Badge
                            key={emp.employeeId}
                            variant="info"
                            className="px-1 py-0 text-caption"
                          >
                            {emp.employeeName}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DashboardOverlay
// ---------------------------------------------------------------------------

/**
 * Full-screen overlay dashboard that replaces the old 280px sidebar tab.
 *
 * Covers the main content area (scene + chat) but the header remains visible.
 * Opens via sidebar tab click or keyboard shortcut (Cmd/Ctrl+D).
 *
 * Uses CSS transitions for enter/exit animation (no Framer Motion).
 */
export function DashboardOverlay({ open, onClose, activeThreadId }: DashboardOverlayProps) {
  const agents = useAgentStates();
  const cost = useCostDashboard();
  const queue = useTaskQueue();
  const errors = useErrorTracking();
  const { notifications, unreadCount, markRead, dismiss, clearAll } = useNotifications();

  const overlayRef = useRef<HTMLDivElement>(null);

  // Topmost Escape + modal stack registration
  const dashboardStackId = 'dashboard-overlay';
  useRegisterModal(open ? dashboardStackId : null, 'overlay');
  useTopmostEscape(open ? dashboardStackId : null, onClose, { enabled: open });
  useFocusTrap(overlayRef, open);

  // Close when clicking the backdrop
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by useTopmostEscape; backdrop click is a mouse affordance only
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-modal bg-surface/80 backdrop-blur-sm transition-opacity duration-200 ease-in-out',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      onClick={handleBackdropClick}
      // biome-ignore lint/a11y/useSemanticElements: <dialog> can't host this fixed full-screen overlay layout
      role="dialog"
      aria-modal="true"
      aria-label="Boss Dashboard"
      aria-hidden={!open}
    >
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 top-12 overflow-y-auto transition-transform duration-200 ease-in-out',
          open ? 'translate-y-0' : 'translate-y-3',
        )}
      >
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Header row */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-black uppercase tracking-wider text-text-primary">
              Boss Dashboard
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-text-muted hover:text-text-primary"
              title="Close dashboard (Esc)"
              aria-label="Close dashboard"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Dashboard grid — responsive 1/2/3 columns */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <CostOverviewCard summary={cost.summary} loading={cost.loading} />
            <CompanyStatusCard agents={agents} />
            <CostByModelCard byModel={cost.byModel} loading={cost.loading} />
            <TaskQueueCard queue={queue} />
            <NotificationsCard
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onDismiss={dismiss}
              onClearAll={clearAll}
            />
            <ErrorHistoryCard errors={errors} />
            <TeamHealthCard agents={agents} />
            <div className="md:col-span-2">
              <RecentActivityCard />
            </div>
            <OutputsCard />
            <ExecutionSummaryCard activeThreadId={activeThreadId ?? null} />
            <FileChangesCard activeThreadId={activeThreadId ?? null} />
            <InsightsCard />
          </div>
        </div>
      </div>
    </div>
  );
}
