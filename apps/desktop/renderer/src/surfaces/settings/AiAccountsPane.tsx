import { isTauriRuntime } from '@/data/adapters.js';
import {
  type AccountCostSnapshot,
  type ApiUsageSnapshot,
  loadAiAccountUsage,
} from '@/data/ai-account-usage.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { CapsLabel, StatusPill } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import type {
  AiAccountDescriptor,
  AiModelCatalogEntry,
  AiRuntimeStatus,
} from '@offisim/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Bot, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

interface SubscriptionUsageSnapshot {
  readonly kind: 'subscription';
  readonly label?: string;
  readonly remaining?: number | string;
  readonly resetAt?: string;
  readonly credits?: number | string;
  readonly updatedAt?: string;
}

interface AccountView extends AiAccountDescriptor {
  readonly usage?: ApiUsageSnapshot | SubscriptionUsageSnapshot;
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
  const status: unknown = await invokeCommand('agent_runtime_status');
  if (!isRuntimeStatus(status)) {
    throw new Error('The desktop runtime returned an invalid account catalog.');
  }
  return status;
}

function checkedAtLabel(value?: string): string {
  if (!value) return 'not checked';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function compactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatLimit(value: number | undefined): string {
  return value === undefined ? 'Not published' : compactNumber(value);
}

function usageHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.usage?.kind === 'api') {
    const additiveBuckets = [
      account.usage.inputTokens,
      account.usage.outputTokens,
      account.usage.cacheReadTokens,
      account.usage.cacheWriteTokens,
    ];
    if (additiveBuckets.every((value): value is number => value !== undefined)) {
      return `${compactNumber(additiveBuckets.reduce((sum, value) => sum + value, 0))} tokens`;
    }
    return `${account.usage.runCount} usage ${account.usage.runCount === 1 ? 'record' : 'records'} · partial`;
  }
  if (account.usage?.kind === 'subscription') {
    if (account.usage.remaining !== undefined) return `${account.usage.remaining} remaining`;
    return account.usage.label ?? 'Native usage';
  }
  return account.capabilities.usage.status === 'available' ? 'No recorded usage' : 'Unavailable';
}

function costHeadline(account: AccountView): string {
  if (account.billingMode === 'subscription') return 'Not calculated';
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.cost?.kind === 'unavailable') {
    return account.cost.knownAmountUsd === undefined
      ? 'Unavailable'
      : `Unavailable · $${account.cost.knownAmountUsd.toFixed(6)} known`;
  }
  if (account.cost) {
    const value = `$${account.cost.amountUsd.toFixed(6)}`;
    return account.cost.kind === 'estimate' ? `~${value}` : value;
  }
  return account.capabilities.cost.status === 'available' ? 'No recorded cost' : 'Unavailable';
}

function modelAvailabilityTone(model: AiModelCatalogEntry) {
  if (model.availability === 'available') return 'ok' as const;
  if (model.availability === 'expiring') return 'warn' as const;
  return 'muted' as const;
}

function AccountUsage({ account }: { account: AccountView }) {
  if (account.billingMode === 'subscription') {
    const usage = account.usage?.kind === 'subscription' ? account.usage : undefined;
    return (
      <div className="off-set-account-usage-grid">
        <div>
          <span>Native usage</span>
          <strong>{usage?.label ?? 'Unavailable'}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{usage?.remaining ?? '—'}</strong>
        </div>
        <div>
          <span>Reset</span>
          <strong>{usage?.resetAt ? checkedAtLabel(usage.resetAt) : '—'}</strong>
        </div>
        <div>
          <span>Credits</span>
          <strong>{usage?.credits ?? '—'}</strong>
        </div>
      </div>
    );
  }

  if (account.accountingStatus === 'loading') {
    return <div className="off-set-callout is-muted">Loading this month's API usage…</div>;
  }
  if (account.accountingStatus === 'error') {
    return (
      <div className="off-set-callout is-warn">
        <Icon icon={TriangleAlert} size="sm" />
        Usage history is unavailable. Refresh to retry.
      </div>
    );
  }
  const usage = account.usage?.kind === 'api' ? account.usage : undefined;
  if (!usage) {
    return <div className="off-set-callout is-muted">No recorded API usage this month.</div>;
  }
  const usageNumber = (value: number | undefined) =>
    value === undefined ? 'Unknown' : compactNumber(value);
  return (
    <div className="off-set-account-usage-grid">
      <div>
        <span>Input</span>
        <strong>{usageNumber(usage.inputTokens)}</strong>
      </div>
      <div>
        <span>Output</span>
        <strong>{usageNumber(usage.outputTokens)}</strong>
      </div>
      <div>
        <span>Cache read / write</span>
        <strong>
          {usageNumber(usage.cacheReadTokens)} / {usageNumber(usage.cacheWriteTokens)}
        </strong>
      </div>
      <div>
        <span>Reasoning</span>
        <strong>{usageNumber(usage.reasoningTokens)}</strong>
      </div>
    </div>
  );
}

function AccountCost({ account }: { account: AccountView }) {
  if (account.billingMode === 'subscription') {
    return (
      <div className="off-set-callout is-muted">
        <Icon icon={Info} size="sm" />
        Subscription usage is shown exactly as reported by the service. It is never converted into a
        token-based cost.
      </div>
    );
  }

  if (account.accountingStatus === 'loading') {
    return <div className="off-set-callout is-muted">Loading this month's API cost…</div>;
  }
  if (account.accountingStatus === 'error') {
    return (
      <div className="off-set-callout is-warn">
        <Icon icon={TriangleAlert} size="sm" />
        Cost history is unavailable. Refresh to retry.
      </div>
    );
  }
  if (!account.cost) {
    return <div className="off-set-callout is-muted">No recorded API cost this month.</div>;
  }
  const cost = account.cost;
  const headline = costHeadline(account);
  const detail =
    cost.kind === 'unavailable'
      ? `${cost.reason}${
          cost.knownAmountUsd === undefined
            ? ''
            : ` · $${cost.knownAmountUsd.toFixed(6)} known subtotal`
        }`
      : cost.kind === 'actual'
        ? 'Actual service-reported cost · This month'
        : 'Estimate from the verified model price · This month';
  return (
    <div className="off-set-account-cost">
      <strong>{headline}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function AiAccountsPane() {
  const desktopAvailable = isTauriRuntime();
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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId(null);
      return;
    }
    if (!accounts.some((account) => account.accountId === selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.accountId ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount =
    accounts.find((account) => account.accountId === selectedAccountId) ?? accounts[0];
  const models = useMemo(
    () =>
      (statusQuery.data?.models ?? []).filter(
        (model) => model.accountId === selectedAccount?.accountId,
      ),
    [selectedAccount?.accountId, statusQuery.data?.models],
  );
  const availableAccountCount = accounts.filter((account) => account.status === 'available').length;

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">AI Accounts</div>
        <div className="off-set-panedesc">
          Review available accounts, exact models, native usage, and cost reporting.
        </div>
      </div>

      <div className="off-set-provider-runtime">
        <div
          className="off-set-pv-logo"
          style={
            {
              '--off-provider-brand-a': UI_DATA_COLORS.blue,
              '--off-provider-brand-b': UI_DATA_COLORS.green,
            } as CSSProperties
          }
        >
          <Icon icon={Bot} size="md" />
        </div>
        <div className="min-w-0">
          <div className="off-set-pv-name">
            AI runtime
            <StatusPill
              tone={statusQuery.isLoading ? 'accent' : availableAccountCount > 0 ? 'ok' : 'muted'}
              running={statusQuery.isLoading}
            >
              {statusQuery.isLoading
                ? 'Checking'
                : availableAccountCount > 0
                  ? 'Ready'
                  : 'Unavailable'}
            </StatusPill>
          </div>
          <div className="off-set-pv-meta">
            {accounts.length} accounts · {statusQuery.data?.models.length ?? 0} exact models ·
            checked {checkedAtLabel(statusQuery.data?.checkedAt)}
          </div>
        </div>
        <Button
          variant="outline"
          size="md"
          disabled={!desktopAvailable || statusQuery.isFetching || accountingQuery.isFetching}
          onClick={() => void Promise.all([statusQuery.refetch(), accountingQuery.refetch()])}
        >
          <Icon icon={RefreshCw} size="sm" />
          {statusQuery.isFetching || accountingQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </Button>
      </div>

      {statusQuery.isError || accountingQuery.isError ? (
        <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
          <Icon icon={TriangleAlert} size="sm" />
          {statusQuery.isError
            ? 'AI account status is unavailable. Refresh to retry.'
            : 'Usage and cost history is unavailable. Refresh to retry.'}
        </div>
      ) : null}
      {!desktopAvailable ? (
        <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
          <Icon icon={Info} size="sm" />
          AI account status is available inside the desktop app.
        </div>
      ) : null}

      <section className="off-set-provider-console">
        <aside className="off-set-provider-list" aria-label="AI accounts">
          <div className="off-set-provider-list-head">
            <CapsLabel>Accounts</CapsLabel>
            <span>{accounts.length}</span>
          </div>
          <div className="off-set-provider-nav-scroll">
            {accounts.map((account) => (
              <button
                type="button"
                key={account.accountId}
                className={`off-set-provider-nav off-focusable ${
                  selectedAccount?.accountId === account.accountId ? 'is-active' : ''
                }`}
                onClick={() => setSelectedAccountId(account.accountId)}
              >
                <span
                  className={`off-set-provider-dot ${
                    account.status === 'available' ? 'is-ready' : 'is-muted'
                  }`}
                />
                <span className="off-set-provider-nav-copy">
                  <span>{account.displayName}</span>
                  <small>{account.billingMode === 'api' ? 'API account' : 'Subscription'}</small>
                </span>
              </button>
            ))}
            {!statusQuery.isLoading && accounts.length === 0 ? (
              <div className="off-set-provider-empty">No available AI accounts.</div>
            ) : null}
          </div>
        </aside>

        <div className="off-set-provider-detail">
          {selectedAccount ? (
            <>
              <div className="off-set-provider-detail-head">
                <div className="min-w-0">
                  <h3>{selectedAccount.displayName}</h3>
                  <p>
                    {selectedAccount.billingMode === 'api' ? 'API account' : 'Subscription account'}
                    {selectedAccount.statusReason ? ` · ${selectedAccount.statusReason}` : ''}
                  </p>
                </div>
                <StatusPill tone={selectedAccount.status === 'available' ? 'ok' : 'muted'}>
                  {selectedAccount.status === 'available' ? 'Available' : 'Unavailable'}
                </StatusPill>
              </div>

              <div className="off-set-provider-summary-grid">
                <div>
                  <span>Models</span>
                  <strong>{models.length} exact</strong>
                </div>
                <div>
                  <span>Usage</span>
                  <strong>{usageHeadline(selectedAccount)}</strong>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>{costHeadline(selectedAccount)}</strong>
                </div>
              </div>

              <section className="off-set-account-section">
                <div className="off-set-sec-head">
                  <CapsLabel>Usage</CapsLabel>
                  <span>
                    {selectedAccount.usage?.kind === 'api'
                      ? `${selectedAccount.usage.periodLabel}${
                          selectedAccount.usage.updatedAt
                            ? ` · updated ${checkedAtLabel(selectedAccount.usage.updatedAt)}`
                            : ''
                        }`
                      : ''}
                  </span>
                </div>
                <AccountUsage account={selectedAccount} />
              </section>

              <section className="off-set-account-section">
                <div className="off-set-sec-head">
                  <CapsLabel>Cost</CapsLabel>
                </div>
                <AccountCost account={selectedAccount} />
              </section>

              <section className="off-set-account-section">
                <div className="off-set-sec-head">
                  <CapsLabel>Models</CapsLabel>
                  <span>{models.length}</span>
                </div>
                <div className="off-set-account-models">
                  {models.map((model) => (
                    <div className="off-set-account-model" key={model.modelId}>
                      <div className="off-set-account-model-copy">
                        <strong>{model.displayName}</strong>
                        <code>{model.modelId}</code>
                      </div>
                      <div className="off-set-account-model-limits">
                        <span>Context {formatLimit(model.contextWindow)}</span>
                        <span>Output {formatLimit(model.maxOutputTokens)}</span>
                      </div>
                      <StatusPill tone={modelAvailabilityTone(model)}>
                        {model.availability === 'expiring'
                          ? 'Expires soon'
                          : model.availability === 'available'
                            ? 'Available'
                            : 'Unavailable'}
                      </StatusPill>
                    </div>
                  ))}
                  {models.length === 0 ? (
                    <div className="off-set-provider-empty">No verified exact models.</div>
                  ) : null}
                </div>
              </section>
            </>
          ) : (
            <div className="off-set-provider-empty">
              {statusQuery.isLoading ? 'Loading AI accounts…' : 'No AI account is available.'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
