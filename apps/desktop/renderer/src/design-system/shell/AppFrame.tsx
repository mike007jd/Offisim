import { useUiState } from '@/app/ui-state.js';
import { useRunCost } from '@/data/queries.js';
import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ScopeBar } from './ScopeBar.js';
import { WorkspaceNav } from './WorkspaceNav.js';

interface AppFrameProps {
  children: ReactNode;
  /**
   * Optional banner row rendered BETWEEN the topbar and the surface host. The
   * surface host fills the rest with `position: absolute` surfaces, so a banner
   * placed inside it would be covered — it needs its own grid row. The slot
   * collapses to zero height when the banner renders nothing.
   */
  banner?: ReactNode;
}

export function AppFrame({ children, banner }: AppFrameProps) {
  const openLifecycle = useUiState((s) => s.openLifecycle);
  const runCost = useRunCost();
  const alert =
    runCost.data?.alerts.find((item) => item.level === 'critical') ?? runCost.data?.alerts[0];
  const lastToastRef = useRef('');
  useEffect(() => {
    const signature = (runCost.data?.alerts ?? [])
      .map((item) => `${item.scope}:${item.level}`)
      .join('|');
    if (!signature) {
      lastToastRef.current = '';
      return;
    }
    if (signature === lastToastRef.current) return;
    lastToastRef.current = signature;
    for (const item of runCost.data?.alerts ?? []) {
      const scope = item.scope === 'monthly' ? 'Monthly company' : 'Current session';
      const message = `${scope} token budget ${item.level === 'critical' ? 'reached' : 'at 80%'}`;
      const detail = `${item.used.toLocaleString()} / ${item.budget.toLocaleString()} tokens`;
      if (item.level === 'critical') toast.error(message, { description: detail });
      else toast.warning(message, { description: detail });
    }
  }, [runCost.data?.alerts]);
  return (
    <main className="off-app">
      <header className="off-topbar">
        <button
          type="button"
          className="off-wordmark off-focusable"
          aria-label="Offisim — back to companies"
          onClick={() => openLifecycle('select')}
        >
          Offisim
        </button>
        <ScopeBar />
        <WorkspaceNav />
        <output
          className={`off-topbar-cost${alert ? ` is-${alert.level}` : ''}`}
          aria-label="Token cost and budget status"
          title={
            alert
              ? `${alert.scope} budget: ${alert.used.toLocaleString()} / ${alert.budget.toLocaleString()} tokens`
              : 'No token budget alert'
          }
        >
          {alert ? <AlertTriangle aria-hidden="true" /> : null}
          <span>{(runCost.data?.monthlyTokens ?? 0).toLocaleString()} tok</span>
          <b>{runCost.data?.costLabel ?? '$0.00'}</b>
        </output>
      </header>
      <div className="off-main-stack">
        <div className="off-banner-slot">{banner}</div>
        <div className="off-surface-host">{children}</div>
      </div>
    </main>
  );
}
