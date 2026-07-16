import { isTauriRuntime } from '@/data/adapters.js';
import {
  type AccountCostSnapshot,
  type ApiUsageSnapshot,
  loadAiAccountUsage,
} from '@/data/ai-account-usage.js';
import {
  aiAccountKindLabel,
  aiAccountLaneKey,
  aiModelSourceLabel,
} from '@/data/ai-model-presentation.js';
import { CapsLabel, CardBlock, StatusPill } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import type {
  AiAccountDescriptor,
  AiModelCatalogEntry,
  AiRuntimeStatus,
  AiSubscriptionUsageSnapshot,
} from '@offisim/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { KeyRound, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiKeyDialog } from './ApiKeyDialog.js';

interface AccountView extends Omit<AiAccountDescriptor, 'usage'> {
  readonly usage?: ApiUsageSnapshot | AiSubscriptionUsageSnapshot;
  readonly cost?: AccountCostSnapshot;
  readonly accountingStatus?: 'loading' | 'error';
}

interface RuntimeStatusView extends Omit<AiRuntimeStatus, 'accounts'> {
  readonly accounts: readonly AccountView[];
}

function isRuntimeStatus(value: unknown): value is RuntimeStatusView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RuntimeStatusView>;
  return (
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.models) &&
    typeof candidate.checkedAt === 'string'
  );
}

async function loadRuntimeStatus(): Promise<RuntimeStatusView> {
  const status: unknown = await invokeCommand('agent_runtime_status', { includeUsage: true });
  if (!isRuntimeStatus(status)) {
    throw new Error('The desktop runtime returned an invalid account catalog.');
  }
  return status;
}

function checkedAtLabel(value?: string, includeTime = true): string {
  if (!value) return 'not checked';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(timestamp);
}

function compactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function subscriptionValue(value: number | string | undefined): string {
  if (value === undefined) return '—';
  return typeof value === 'number' ? compactNumber(value) : value;
}

function formatWindowDuration(minutes?: number): string | null {
  if (!minutes || !Number.isFinite(minutes)) return null;
  if (minutes % 10_080 === 0) return `${minutes / 10_080}-week window`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

function formatDurationSeconds(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return (
    [days ? `${days}d` : '', hours ? `${hours}h` : '', !days && minutes ? `${minutes}m` : '']
      .filter(Boolean)
      .join(' ') || '<1m'
  );
}

function accountLane(account: Pick<AccountView, 'engineId' | 'accountId' | 'billingMode'>) {
  return aiAccountLaneKey(account.engineId, account.accountId, account.billingMode);
}

function modelAvailabilityTone(model: AiModelCatalogEntry) {
  if (model.availability === 'available') return 'ok' as const;
  if (model.availability === 'expiring') return 'warn' as const;
  return 'muted' as const;
}

function modelAvailabilityDetail(model: AiModelCatalogEntry): string | null {
  if (model.expiresAt) return `Expires ${checkedAtLabel(model.expiresAt)}`;
  if (model.availabilityReason?.trim()) return model.availabilityReason.trim();
  if (model.availability === 'expiring') return 'Expiration date not reported';
  if (model.availability === 'unavailable') return 'Availability not reported';
  return null;
}

function usageHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.usage?.kind === 'api') {
    const buckets = [
      account.usage.inputTokens,
      account.usage.outputTokens,
      account.usage.cacheReadTokens,
      account.usage.cacheWriteTokens,
    ];
    if (buckets.every((value): value is number => value !== undefined)) {
      return `${compactNumber(buckets.reduce((sum, value) => sum + value, 0))} tokens`;
    }
    return `${account.usage.runCount} ${account.usage.runCount === 1 ? 'run' : 'runs'} · partial`;
  }
  if (account.usage?.kind === 'subscription') {
    const firstWindow = account.usage.limits.flatMap((limit) => limit.windows)[0];
    if (firstWindow) return `${subscriptionValue(firstWindow.remaining)} remaining`;
    const credits = account.usage.limits.find((limit) => limit.credits !== undefined)?.credits;
    return credits === undefined ? 'Native usage' : `${subscriptionValue(credits)} credits`;
  }
  return account.capabilities.usage.status === 'available' ? 'No recorded usage' : 'Unavailable';
}

function costHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.cost?.kind === 'unavailable') {
    return account.cost.knownAmountUsd === undefined
      ? 'Unavailable'
      : `$${account.cost.knownAmountUsd.toFixed(6)} known`;
  }
  if (account.cost) {
    const value = `$${account.cost.amountUsd.toFixed(6)}`;
    return account.cost.kind === 'estimate' ? `~${value}` : value;
  }
  return account.capabilities.cost.status === 'available' ? 'No recorded cost' : 'Unavailable';
}

function SubscriptionUsage({ usage }: { usage: AiSubscriptionUsageSnapshot }) {
  return (
    <>
      <div className="off-set-account-usage-grid">
        {usage.limits.flatMap((limit) =>
          limit.windows.map((window) => {
            const windowLabel =
              window.kind === 'spendControl'
                ? 'Spend control'
                : (formatWindowDuration(window.windowDurationMins) ??
                  (window.kind === 'primary' ? 'Primary window' : 'Secondary window'));
            const reset = window.resetAt ? `Resets ${checkedAtLabel(window.resetAt)}` : null;
            const value =
              window.kind === 'spendControl'
                ? `${subscriptionValue(window.remaining)} remaining of ${subscriptionValue(window.limit)}`
                : `${subscriptionValue(window.remaining)} remaining`;
            return (
              <div key={`${limit.limitId}:${window.kind}`}>
                <span>
                  {limit.label} · {windowLabel}
                </span>
                <strong>{value}</strong>
                {reset ? <small>{reset}</small> : null}
                {window.remainingIsDerived ? <small>Estimated from reported usage</small> : null}
              </div>
            );
          }),
        )}
        {usage.limits
          .filter((limit) => limit.credits !== undefined)
          .map((limit) => (
            <div key={`${limit.limitId}:credits`}>
              <span>{limit.label} · Credits</span>
              <strong>{subscriptionValue(limit.credits)}</strong>
            </div>
          ))}
        {usage.resetCredits !== undefined ? (
          <div>
            <span>Rate-limit reset credits</span>
            <strong>{subscriptionValue(usage.resetCredits)}</strong>
          </div>
        ) : null}
      </div>
      {usage.activity ? (
        <div className="off-set-account-activity">
          <span>Activity</span>
          {usage.activity.lifetimeTokens !== undefined ? (
            <strong>{compactNumber(usage.activity.lifetimeTokens)} lifetime tokens</strong>
          ) : null}
          {usage.activity.peakDailyTokens !== undefined ? (
            <strong>{compactNumber(usage.activity.peakDailyTokens)} peak-day tokens</strong>
          ) : null}
          {usage.activity.longestRunningTurnSec !== undefined ? (
            <strong>
              {formatDurationSeconds(usage.activity.longestRunningTurnSec)} longest turn
            </strong>
          ) : null}
          {usage.activity.currentStreakDays !== undefined ? (
            <strong>{usage.activity.currentStreakDays} day current streak</strong>
          ) : null}
          {usage.activity.longestStreakDays !== undefined ? (
            <strong>{usage.activity.longestStreakDays} day longest streak</strong>
          ) : null}
        </div>
      ) : null}
      {usage.updatedAt ? (
        <p className="off-set-account-updated">Updated {checkedAtLabel(usage.updatedAt)}</p>
      ) : null}
    </>
  );
}

function AccountUsage({ account }: { account: AccountView }) {
  if (account.accountingStatus === 'loading') {
    return <div className="off-set-callout is-muted">Loading usage…</div>;
  }
  if (account.accountingStatus === 'error') {
    return (
      <div className="off-set-callout is-warn">
        <Icon icon={TriangleAlert} size="sm" />
        Usage history is unavailable. Refresh to retry.
      </div>
    );
  }
  if (account.usage?.kind === 'subscription') {
    return <SubscriptionUsage usage={account.usage} />;
  }
  if (account.usage?.kind !== 'api') {
    return (
      <div className="off-set-callout is-muted">
        {account.billingMode === 'subscription'
          ? 'Subscription usage is not available from this service.'
          : 'No recorded API usage this month.'}
      </div>
    );
  }
  const usageNumber = (value: number | undefined) =>
    value === undefined ? 'Unknown' : compactNumber(value);
  return (
    <div className="off-set-account-usage-grid">
      <div>
        <span>Input</span>
        <strong>{usageNumber(account.usage.inputTokens)}</strong>
      </div>
      <div>
        <span>Output</span>
        <strong>{usageNumber(account.usage.outputTokens)}</strong>
      </div>
      <div>
        <span>Cache read / write</span>
        <strong>
          {usageNumber(account.usage.cacheReadTokens)} /{' '}
          {usageNumber(account.usage.cacheWriteTokens)}
        </strong>
      </div>
      <div>
        <span>Reasoning</span>
        <strong>{usageNumber(account.usage.reasoningTokens)}</strong>
      </div>
    </div>
  );
}

function AccountCost({ account }: { account: AccountView }) {
  if (account.accountingStatus === 'loading') {
    return <div className="off-set-callout is-muted">Loading this month's API cost…</div>;
  }
  if (account.accountingStatus === 'error') {
    return <div className="off-set-callout is-warn">API cost history is unavailable.</div>;
  }
  if (!account.cost) {
    return <div className="off-set-callout is-muted">No recorded API cost this month.</div>;
  }
  const detail =
    account.cost.kind === 'unavailable'
      ? account.cost.reason
      : account.cost.kind === 'actual'
        ? 'Actual service-reported cost · This month'
        : 'Estimate from verified model pricing · This month';
  return (
    <div className="off-set-account-cost">
      <strong>{costHeadline(account)}</strong>
      <span>{detail}</span>
    </div>
  );
}

function ModelRow({ model }: { model: AiModelCatalogEntry }) {
  const availabilityDetail = modelAvailabilityDetail(model);
  return (
    <article className="off-set-account-model">
      <div className="off-set-account-model-copy">
        <strong>{model.displayName}</strong>
        <code>{model.modelId}</code>
        <a
          className="off-set-account-model-source off-focusable"
          href={model.source.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={model.source.sourceUrl}
        >
          {aiModelSourceLabel(model.source)}
        </a>
        {availabilityDetail ? (
          <span className="off-set-account-model-availability">{availabilityDetail}</span>
        ) : null}
      </div>
      <div className="off-set-account-model-limits">
        <span>
          Context{' '}
          {model.contextWindow === undefined ? 'Not published' : compactNumber(model.contextWindow)}
        </span>
        <span>
          Output{' '}
          {model.maxOutputTokens === undefined
            ? 'Not published'
            : compactNumber(model.maxOutputTokens)}
        </span>
      </div>
      <StatusPill tone={modelAvailabilityTone(model)}>
        {model.availability === 'expiring'
          ? 'Expiring'
          : model.availability === 'available'
            ? 'Available'
            : 'Unavailable'}
      </StatusPill>
    </article>
  );
}

function ModelList({ models }: { models: readonly AiModelCatalogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 108,
    overscan: 5,
  });
  if (models.length <= 24) {
    return (
      <div className="off-set-account-models">
        {models.map((model) => (
          <ModelRow key={model.runtimeModelRef} model={model} />
        ))}
      </div>
    );
  }
  return (
    <div ref={scrollRef} className="off-set-account-models is-virtualized">
      <div className="off-set-account-model-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const model = models[item.index];
          if (!model) return null;
          return (
            <div
              key={model.runtimeModelRef}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="off-set-account-model-virtual-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <ModelRow model={model} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AiAccountsPane() {
  const desktopAvailable = isTauriRuntime();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['settings', 'agent-runtime-status'],
    queryFn: loadRuntimeStatus,
    enabled: desktopAvailable,
    staleTime: 60_000,
    retry: false,
  });
  const accountingQuery = useQuery({
    queryKey: ['settings', 'ai-account-usage'],
    queryFn: loadAiAccountUsage,
    enabled: desktopAvailable,
    staleTime: 60_000,
    retry: false,
  });
  const accounts = useMemo(() => {
    const accounting = new Map(
      (accountingQuery.data ?? []).map((snapshot) => [snapshot.accountId, snapshot] as const),
    );
    return (statusQuery.data?.accounts ?? []).map((account) => {
      if (account.billingMode === 'subscription') return account;
      const snapshot = accounting.get(account.accountId);
      return {
        ...account,
        ...(snapshot ? { usage: snapshot.usage, cost: snapshot.cost } : {}),
        ...(accountingQuery.isLoading
          ? { accountingStatus: 'loading' as const }
          : accountingQuery.isError
            ? { accountingStatus: 'error' as const }
            : {}),
      };
    });
  }, [accountingQuery.data, accountingQuery.isError, accountingQuery.isLoading, statusQuery.data]);
  const [selectedLane, setSelectedLane] = useState<string>('');
  const [keyDialog, setKeyDialog] = useState<{ accountId?: string } | null>(null);

  useEffect(() => {
    const firstAccount = accounts[0];
    if (!firstAccount) {
      setSelectedLane('');
      return;
    }
    if (!accounts.some((account) => accountLane(account) === selectedLane)) {
      setSelectedLane(accountLane(firstAccount));
    }
  }, [accounts, selectedLane]);

  const selectedAccount = accounts.find((account) => accountLane(account) === selectedLane);
  const models = useMemo(
    () =>
      (statusQuery.data?.models ?? []).filter(
        (model) =>
          selectedAccount &&
          aiAccountLaneKey(model.engineId, model.accountId, model.billingMode) ===
            accountLane(selectedAccount),
      ),
    [selectedAccount, statusQuery.data?.models],
  );
  const apiAccounts = accounts.filter((account) => account.billingMode === 'api');
  const subscriptions = accounts.filter((account) => account.billingMode === 'subscription');

  async function refreshAccounts() {
    await Promise.all([statusQuery.refetch(), accountingQuery.refetch()]);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['agent-runtime', 'models'],
        refetchType: 'active',
      }),
      queryClient.invalidateQueries({
        queryKey: ['agent-runtime', 'thread-authority'],
        refetchType: 'active',
      }),
    ]);
  }

  async function handleApiConfigured(status: AiRuntimeStatus) {
    const configuredAccount = status.accounts.find(
      (account) => account.billingMode === 'api' && account.status === 'available',
    );
    await refreshAccounts();
    if (configuredAccount) setSelectedLane(accountLane(configuredAccount));
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead off-set-account-panehead">
        <div>
          <div className="off-set-panetitle">AI Accounts</div>
          <div className="off-set-panedesc">Accounts, exact models, usage, and API cost.</div>
        </div>
        <div className="off-set-account-actions">
          <Button variant="outline" size="sm" onClick={() => setKeyDialog({})}>
            <Icon icon={Plus} size="sm" /> Add API account
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void refreshAccounts()}
            disabled={statusQuery.isFetching}
          >
            <Icon icon={RefreshCw} size="sm" /> {statusQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <CardBlock className="off-set-account-catalog-status">
        <div>
          <strong>
            {accounts.filter((account) => account.status === 'available').length} available
          </strong>
          <span>
            {apiAccounts.length} API · {subscriptions.length} subscription
          </span>
        </div>
        <span>Checked {checkedAtLabel(statusQuery.data?.checkedAt)}</span>
      </CardBlock>

      {accounts.length ? (
        <Tabs value={selectedLane} onValueChange={setSelectedLane} className="off-set-account-tabs">
          <TabsList className="off-set-account-tablist" aria-label="AI accounts">
            {apiAccounts.length ? <span className="off-set-account-tabgroup">API</span> : null}
            {apiAccounts.map((account) => (
              <TabsTrigger
                key={accountLane(account)}
                value={accountLane(account)}
                className="off-set-account-tab"
              >
                <span
                  className={`off-set-account-dot ${account.status === 'available' ? 'is-ready' : ''}`}
                />
                {account.displayName}
              </TabsTrigger>
            ))}
            {subscriptions.length ? (
              <span className="off-set-account-tabgroup">Subscriptions</span>
            ) : null}
            {subscriptions.map((account) => (
              <TabsTrigger
                key={accountLane(account)}
                value={accountLane(account)}
                className="off-set-account-tab"
              >
                <span
                  className={`off-set-account-dot ${account.status === 'available' ? 'is-ready' : ''}`}
                />
                {account.displayName}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {selectedAccount ? (
        <div className="off-set-account-detail">
          <header className="off-set-account-detail-head">
            <div>
              <div className="off-set-account-titleline">
                <h3>{selectedAccount.displayName}</h3>
                <StatusPill tone={selectedAccount.status === 'available' ? 'ok' : 'muted'}>
                  {selectedAccount.status === 'available' ? 'Available' : 'Unavailable'}
                </StatusPill>
              </div>
              <p>{aiAccountKindLabel(selectedAccount.billingMode)} account</p>
            </div>
            {selectedAccount.billingMode === 'api' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setKeyDialog({ accountId: selectedAccount.accountId })}
              >
                <Icon icon={KeyRound} size="sm" /> Replace API key
              </Button>
            ) : null}
          </header>

          {selectedAccount.statusReason ? (
            <div
              className={`off-set-callout ${selectedAccount.status === 'available' ? 'is-muted' : 'is-warn'}`}
            >
              {selectedAccount.statusReason}
            </div>
          ) : null}

          <div
            className={`off-set-provider-summary-grid ${selectedAccount.billingMode === 'subscription' ? 'is-subscription' : ''}`}
          >
            <div>
              <span>Models</span>
              <strong>{models.length}</strong>
            </div>
            <div>
              <span>Usage</span>
              <strong>{usageHeadline(selectedAccount)}</strong>
            </div>
            {selectedAccount.billingMode === 'api' ? (
              <div>
                <span>Cost</span>
                <strong>{costHeadline(selectedAccount)}</strong>
              </div>
            ) : null}
          </div>

          <section className="off-set-account-section">
            <div className="off-set-sec-head">
              <CapsLabel>Usage</CapsLabel>
              <span>
                {selectedAccount.billingMode === 'api'
                  ? selectedAccount.usage?.kind === 'api'
                    ? selectedAccount.usage.periodLabel
                    : 'This month'
                  : 'Provider reported'}
              </span>
            </div>
            <AccountUsage account={selectedAccount} />
          </section>

          {selectedAccount.billingMode === 'api' ? (
            <section className="off-set-account-section">
              <div className="off-set-sec-head">
                <CapsLabel>Cost</CapsLabel>
              </div>
              <AccountCost account={selectedAccount} />
            </section>
          ) : null}

          <section className="off-set-account-section">
            <div className="off-set-sec-head">
              <CapsLabel>Models</CapsLabel>
              <span>{models.length}</span>
            </div>
            {models.length ? (
              <ModelList models={models} />
            ) : (
              <div className="off-set-provider-empty">
                No verified exact models are available for this account.
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="off-set-provider-empty">
          {statusQuery.isLoading
            ? 'Loading AI accounts…'
            : 'No AI account is available. Add an API account to begin.'}
        </div>
      )}

      <ApiKeyDialog
        open={keyDialog !== null}
        onOpenChange={(open) => !open && setKeyDialog(null)}
        {...(keyDialog?.accountId ? { accountId: keyDialog.accountId } : {})}
        onConfigured={handleApiConfigured}
      />
    </div>
  );
}
