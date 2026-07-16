import { useUiState } from '@/app/ui-state.js';
import { useRunCost } from '@/data/queries.js';
import { formatUsageTokens } from '@/data/usage-token-coverage.js';
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
  const openSettings = useUiState((s) => s.openSettings);
  const runCost = useRunCost();
  const alert =
    runCost.data?.alerts.find((item) => item.level === 'critical') ?? runCost.data?.alerts[0];
  const monthlyUsage = {
    knownTokens: runCost.data?.monthlyKnownTokens ?? 0,
    coverage: runCost.data?.monthlyTokenCoverage ?? ('unavailable' as const),
  };
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
      const message = `${scope} token alert ${item.level === 'critical' ? 'threshold reached' : 'at 80%'}`;
      const detail = `${item.lowerBound ? 'At least ' : ''}${item.used.toLocaleString()} / ${item.budget.toLocaleString()} tokens. Advisory only — this run continues.`;
      toast.warning(message, {
        description: detail,
        action: { label: 'Budget settings', onClick: () => openSettings('runtime') },
      });
    }
  }, [openSettings, runCost.data?.alerts]);
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
              ? `${alert.scope} token alert: ${alert.lowerBound ? 'at least ' : ''}${alert.used.toLocaleString()} / ${alert.budget.toLocaleString()} tokens; advisory only`
              : monthlyUsage.coverage === 'partial'
                ? 'Usage incomplete — showing the known token subtotal.'
                : monthlyUsage.coverage === 'unavailable'
                  ? 'Token usage unavailable'
                  : 'No token budget alert'
          }
        >
          {alert ? <AlertTriangle aria-hidden="true" /> : null}
          <span>{formatUsageTokens(monthlyUsage)}</span>
          <b>{runCost.data?.costLabel ?? 'Cost pending'}</b>
        </output>
      </header>
      <div className="off-main-stack">
        <div className="off-banner-slot">{banner}</div>
        <div className="off-surface-host">{children}</div>
      </div>
    </main>
  );
}
