import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@aics/ui-core';
import { AlertTriangle, Bell, FileOutput, Trash2, X, XCircle } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef } from 'react';
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
import { RecentActivityCard } from './RecentActivityCard';
import { TaskQueueCard } from './TaskQueueCard';
import { TeamHealthCard } from './TeamHealthCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DashboardOverlayProps {
  open: boolean;
  onClose: () => void;
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
  const LEVEL_COLORS: Record<Notification['level'], string> = {
    info: 'text-blue-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="error" className="text-[10px]">
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
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <p className="text-xs text-slate-400/50">No notifications</p>
        ) : (
          <ScrollArea className="max-h-48">
            <div className="flex flex-col gap-1">
              {notifications.slice(0, 20).map((n) => (
                <div
                  key={n.notificationId}
                  className={`flex items-start gap-2 rounded p-1.5 transition-colors hover:bg-slate-800/30 ${
                    n.read ? 'opacity-50' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="flex flex-1 items-start gap-2 rounded border-0 bg-transparent p-0 text-left appearance-none cursor-pointer"
                    onClick={() => !n.read && onMarkRead(n.notificationId)}
                  >
                    <div
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${(LEVEL_COLORS[n.level] ?? 'text-blue-400').replace('text-', 'bg-')}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400 leading-tight truncate">{n.title}</p>
                      <p className="text-[10px] text-slate-400/60 leading-tight mt-0.5 line-clamp-3">
                        {n.message}
                      </p>
                    </div>
                    <span className="text-[9px] text-slate-400/40 shrink-0">
                      {formatTimestamp(n.timestamp)}
                    </span>
                  </button>
                  {n.dismissable && (
                    <button
                      type="button"
                      className="shrink-0 text-slate-400/40 hover:text-slate-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(n.notificationId);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
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
        <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Error History
          {errors.length > 0 && (
            <Badge variant="error" className="text-[10px]">
              {errors.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <p className="text-xs text-slate-400/50">No errors recorded</p>
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
                    className="rounded border border-slate-700 bg-slate-800/10 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle
                        className={`h-3.5 w-3.5 shrink-0 ${err.recoverable ? 'text-yellow-400' : 'text-red-400'}`}
                      />
                      <span className="text-xs font-mono text-slate-400 truncate">
                        {err.errorCode}
                      </span>
                      <span className="text-[9px] text-slate-400/40 ml-auto shrink-0">
                        {formatTimestamp(err.timestamp)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400/70 mt-1 line-clamp-3">{err.message}</p>
                    {err.nodeName && (
                      <span className="text-[9px] text-slate-400/40 mt-0.5 block">
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
        <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <FileOutput className="h-4 w-4" />
          Recent Outputs
          {deliverables.length > 0 && (
            <Badge variant="info" className="text-[10px]">
              {deliverables.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deliverables.length === 0 ? (
          <p className="text-xs text-slate-400/50">
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
                  <div key={d.id} className="rounded border border-slate-700 bg-slate-800/10 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-100 truncate">{d.title}</span>
                      <span className="text-[9px] text-slate-400/40 shrink-0 ml-2">
                        {formatTimestamp(d.createdAt)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400/60 mt-1 line-clamp-2">
                      {truncate(d.content, 120)}
                    </p>
                    {d.contributingEmployees.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.contributingEmployees.map((emp) => (
                          <Badge
                            key={emp.employeeId}
                            variant="info"
                            className="text-[9px] px-1 py-0"
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
export function DashboardOverlay({ open, onClose }: DashboardOverlayProps) {
  const agents = useAgentStates();
  const cost = useCostDashboard();
  const queue = useTaskQueue();
  const errors = useErrorTracking();
  const { notifications, unreadCount, markRead, dismiss, clearAll } = useNotifications();

  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Close when clicking the backdrop
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  // CSS transition styles
  const overlayStyle: CSSProperties = {
    opacity: open ? 1 : 0,
    pointerEvents: open ? 'auto' : 'none',
    transition: 'opacity 200ms ease-in-out',
  };

  const panelStyle: CSSProperties = {
    transform: open ? 'translateY(0)' : 'translateY(12px)',
    transition: 'transform 200ms ease-in-out',
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-40 bg-slate-900/80 backdrop-blur-sm"
      style={overlayStyle}
      onClick={handleBackdropClick}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
      aria-hidden={!open}
    >
      <div className="absolute inset-x-0 top-12 bottom-0 overflow-y-auto" style={panelStyle}>
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Header row */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-black text-lg text-slate-100 uppercase tracking-wider">
              Boss Dashboard
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-100"
              title="Close dashboard (Esc)"
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
          </div>
        </div>
      </div>
    </div>
  );
}
