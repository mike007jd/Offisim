import {
  Badge,
  Button,
  Card,
  CardButton,
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

const DASHBOARD_CARD_TITLE_CLASS =
  'flex items-center gap-sp-2 text-fs-sm font-semibold uppercase tracking-wide text-ink-3';
const DASHBOARD_ICON_CLASS = 'size-4 shrink-0';
const DASHBOARD_ACTION_ICON_CLASS = 'size-3';
const DASHBOARD_CLOSE_ICON_CLASS = 'size-5';
const DASHBOARD_STATUS_DOT_CLASS = 'mt-sp-1 size-2 shrink-0 rounded-full';
const DASHBOARD_ROW_ICON_CLASS = 'size-3.5 shrink-0';
const DASHBOARD_EMPTY_CLASS = 'text-fs-sm text-ink-3';
const DASHBOARD_LIST_CLASS = 'flex flex-col gap-sp-2';
const DASHBOARD_ROW_CLASS =
  'relative flex items-start gap-sp-2 rounded-r-sm border border-transparent p-sp-2 transition-colors hover:border-line-soft hover:bg-surface-sunken';
const DASHBOARD_ITEM_CLASS = 'rounded-r-sm border border-line-soft bg-surface-2 p-sp-2';
const DASHBOARD_SCROLL_SHORT_CLASS = 'max-h-dashboard-card-list';
const DASHBOARD_OVERLAY_CONTENT_CLASS = 'mx-auto max-w-dashboard-overlay px-sp-7 py-sp-6';
const DASHBOARD_OVERLAY_HEADER_CLASS = 'mb-sp-6 flex items-center justify-between';
const DASHBOARD_OVERLAY_TITLE_CLASS =
  'text-fs-lg font-semibold uppercase tracking-ls-caps text-ink-1';
const DASHBOARD_GRID_CLASS = 'grid grid-cols-1 gap-sp-4 lg:grid-cols-2 xl:grid-cols-3';

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
    info: 'bg-accent',
    success: 'bg-ok',
    warning: 'bg-warn',
    error: 'bg-danger',
  };

  return (
    <Card>
      <CardHeader className="pb-sp-2">
        <div className="flex items-center justify-between">
          <CardTitle className={DASHBOARD_CARD_TITLE_CLASS}>
            <Bell className={DASHBOARD_ICON_CLASS} />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="error" size="xs">
                {unreadCount}
              </Badge>
            )}
          </CardTitle>
          {notifications.length > 0 && (
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onClearAll}
              title="Clear all"
              aria-label="Clear all notifications"
            >
              <Trash2 className={DASHBOARD_ACTION_ICON_CLASS} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <p className={DASHBOARD_EMPTY_CLASS}>No notifications</p>
        ) : (
          <ScrollArea className={DASHBOARD_SCROLL_SHORT_CLASS}>
            <div className={DASHBOARD_LIST_CLASS}>
              {notifications.slice(0, 20).map((n) => (
                <div
                  key={n.notificationId}
                  className={cn(DASHBOARD_ROW_CLASS, n.read && 'opacity-50')}
                >
                  <CardButton
                    aria-label={
                      n.read
                        ? `Notification already read: ${n.title}`
                        : `Mark notification read: ${n.title}`
                    }
                    aria-disabled={n.read}
                    onClick={() => !n.read && onMarkRead(n.notificationId)}
                  />
                  <div className={cn(DASHBOARD_STATUS_DOT_CLASS, levelDotClass[n.level])} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-fs-sm leading-tight text-ink-2">{n.title}</p>
                    <p className="mt-sp-1 line-clamp-3 text-fs-micro leading-tight text-ink-3">
                      {n.message}
                    </p>
                  </div>
                  <span className="shrink-0 text-fs-micro text-ink-3">
                    {formatTimestamp(n.timestamp)}
                  </span>
                  {n.dismissable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      className="z-elevated shrink-0 text-ink-3 hover:text-ink-2"
                      aria-label={`Dismiss notification: ${n.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(n.notificationId);
                      }}
                    >
                      <X className={DASHBOARD_ACTION_ICON_CLASS} />
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
      <CardHeader className="pb-sp-2">
        <CardTitle className={DASHBOARD_CARD_TITLE_CLASS}>
          <AlertTriangle className={DASHBOARD_ICON_CLASS} />
          Error History
          {errors.length > 0 && (
            <Badge variant="error" size="xs">
              {errors.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <p className={DASHBOARD_EMPTY_CLASS}>No errors recorded</p>
        ) : (
          <ScrollArea className={DASHBOARD_SCROLL_SHORT_CLASS}>
            <div className={DASHBOARD_LIST_CLASS}>
              {errors
                .slice()
                .reverse()
                .slice(0, 20)
                .map((err, i) => (
                  <div
                    key={`${err.errorCode}-${err.timestamp}-${i}`}
                    className={DASHBOARD_ITEM_CLASS}
                  >
                    <div className="flex items-center gap-sp-2">
                      <XCircle
                        className={cn(
                          DASHBOARD_ROW_ICON_CLASS,
                          err.recoverable ? 'text-warn' : 'text-danger',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-fs-sm text-ink-2">
                        {err.errorCode}
                      </span>
                      <span className="ml-auto shrink-0 text-fs-micro text-ink-3">
                        {formatTimestamp(err.timestamp)}
                      </span>
                    </div>
                    <p className="mt-sp-1 line-clamp-3 text-fs-micro text-ink-2">{err.message}</p>
                    {err.nodeName && (
                      <span className="mt-sp-1 block text-fs-micro text-ink-3">
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
      <CardHeader className="pb-sp-2">
        <CardTitle className={DASHBOARD_CARD_TITLE_CLASS}>
          <FileOutput className={DASHBOARD_ICON_CLASS} />
          Recent Outputs
          {deliverables.length > 0 && (
            <Badge variant="info" size="xs">
              {deliverables.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deliverables.length === 0 ? (
          <p className={DASHBOARD_EMPTY_CLASS}>
            No outputs yet. Deliverables will appear after tasks complete.
          </p>
        ) : (
          <ScrollArea className={DASHBOARD_SCROLL_SHORT_CLASS}>
            <div className={DASHBOARD_LIST_CLASS}>
              {deliverables
                .slice()
                .reverse()
                .slice(0, 10)
                .map((d) => (
                  <div key={d.id} className={DASHBOARD_ITEM_CLASS}>
                    <div className="flex items-center justify-between">
                      <span className="min-w-0 flex-1 truncate text-fs-sm text-ink-1">
                        {d.title}
                      </span>
                      <span className="ml-sp-2 shrink-0 text-fs-micro text-ink-3">
                        {formatTimestamp(d.createdAt)}
                      </span>
                    </div>
                    <p className="mt-sp-1 line-clamp-2 text-fs-micro text-ink-3">
                      {truncate(d.content, 120)}
                    </p>
                    {d.contributingEmployees.length > 0 && (
                      <div className="mt-sp-1 flex flex-wrap gap-sp-1">
                        {d.contributingEmployees.map((emp) => (
                          <Badge key={emp.employeeId} variant="info" size="xs">
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
        <div className={DASHBOARD_OVERLAY_CONTENT_CLASS}>
          {/* Header row */}
          <div className={DASHBOARD_OVERLAY_HEADER_CLASS}>
            <h2 className={DASHBOARD_OVERLAY_TITLE_CLASS}>Boss Dashboard</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-ink-3 hover:text-ink-1"
              title="Close dashboard (Esc)"
              aria-label="Close dashboard"
            >
              <X className={DASHBOARD_CLOSE_ICON_CLASS} />
            </Button>
          </div>

          {/* Dashboard grid — responsive 1/2/3 columns */}
          <div className={DASHBOARD_GRID_CLASS}>
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
