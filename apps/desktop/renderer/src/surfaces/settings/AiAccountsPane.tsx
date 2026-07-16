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
  OrchestrationEngineStatus,
} from '@offisim/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Info,
  RefreshCw,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

interface AccountView extends Omit<AiAccountDescriptor, 'usage'> {
  readonly usage?: ApiUsageSnapshot;
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
    Array.isArray(candidate.orchestrationEngines) &&
    typeof candidate.checkedAt === 'string'
  );
}

async function loadRuntimeStatus(): Promise<RuntimeStatusView> {
  const status: unknown = await invokeCommand('agent_runtime_status', { includeUsage: true });
  if (!isRuntimeStatus(status)) {
    throw new Error('The desktop runtime returned an invalid AI engine status.');
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
  if (!account.usage) return 'No recorded usage';
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

function costHeadline(account: AccountView): string {
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
  return 'No recorded cost';
}

function modelAvailabilityTone(model: AiModelCatalogEntry) {
  if (model.availability === 'available') return 'ok' as const;
  if (model.availability === 'expiring') return 'warn' as const;
  return 'muted' as const;
}

function modelAvailabilityDetail(model: AiModelCatalogEntry): string | null {
  const parts: string[] = [];
  if (model.availabilityReason?.trim()) parts.push(model.availabilityReason.trim());
  if (model.expiresAt) parts.push(`Expires ${checkedAtLabel(model.expiresAt)}`);
  else if (model.availability === 'expiring') parts.push('Expiration date not reported');
  else if (model.availability === 'unavailable' && parts.length === 0) {
    parts.push('No availability reason reported');
  }
  return parts.length ? parts.join(' · ') : null;
}

function AccountUsage({ account }: { account: AccountView }) {
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
  if (!account.usage) {
    return <div className="off-set-callout is-muted">No recorded API usage this month.</div>;
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
  const detail =
    account.cost.kind === 'unavailable'
      ? `${account.cost.reason}${
          account.cost.knownAmountUsd === undefined
            ? ''
            : ` · $${account.cost.knownAmountUsd.toFixed(6)} known subtotal`
        }`
      : account.cost.kind === 'actual'
        ? 'Actual service-reported cost · This month'
        : 'Estimate from the verified model price · This month';
  return (
    <div className="off-set-account-cost">
      <strong>{costHeadline(account)}</strong>
      <span>{detail}</span>
    </div>
  );
}

function orchestrationStateLabel(state: OrchestrationEngineStatus['state']): string {
  if (state === 'not-installed') return 'Not installed';
  if (state === 'not-signed-in') return 'Not signed in';
  if (state === 'ready') return 'Ready';
  return 'Unavailable';
}

function OrchestrationEngineCard({ engine }: { engine: OrchestrationEngineStatus }) {
  const [copied, setCopied] = useState(false);
  const copyLoginCommand = async () => {
    await navigator.clipboard.writeText(engine.loginCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const docsUrl = (() => {
    try {
      const parsed = new URL(engine.docsUrl);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  })();
  return (
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
        <Icon icon={Terminal} size="md" />
      </div>
      <div className="min-w-0">
        <div className="off-set-pv-name">
          {engine.displayName}
          <StatusPill
            tone={
              engine.state === 'ready' ? 'ok' : engine.state === 'unavailable' ? 'muted' : 'warn'
            }
          >
            {orchestrationStateLabel(engine.state)}
          </StatusPill>
        </div>
        <div className="off-set-pv-meta">
          {engine.version ? `Version ${engine.version} · ` : ''}订阅内 · 无 API 成本 · checked{' '}
          {checkedAtLabel(engine.checkedAt)}
        </div>
        {engine.statusReason ? <div className="off-set-pv-meta">{engine.statusReason}</div> : null}
      </div>
      <Button variant="outline" size="md" onClick={() => void copyLoginCommand()}>
        <Icon icon={copied ? Check : Copy} size="sm" />
        {copied ? 'Copied' : `Copy ${engine.loginCommand}`}
      </Button>
      {docsUrl ? (
        <Button variant="outline" size="md" asChild>
          <a href={docsUrl} target="_blank" rel="noreferrer">
            <Icon icon={ExternalLink} size="sm" />
            Official guide
          </a>
        </Button>
      ) : null}
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
    return (statusQuery.data?.accounts ?? [])
      .filter((account) => account.engineId === 'api' && account.billingMode === 'api')
      .map((account) => {
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
  const orchestrationEngines = statusQuery.data?.orchestrationEngines ?? [];
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!accounts.length) {
      setSelectedAccountId(null);
    } else if (!accounts.some((account) => account.accountId === selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.accountId ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount =
    accounts.find((account) => account.accountId === selectedAccountId) ?? accounts[0];
  const models = useMemo(
    () =>
      (statusQuery.data?.models ?? []).filter(
        (model) => model.engineId === 'api' && model.accountId === selectedAccount?.accountId,
      ),
    [selectedAccount?.accountId, statusQuery.data?.models],
  );
  const refreshAccounts = async () => {
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
  };

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">AI Accounts</div>
        <div className="off-set-panedesc">
          Configure API-backed work and connect external CLI orchestration engines.
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
            AI engines
            <StatusPill
              tone={statusQuery.isLoading ? 'accent' : 'ok'}
              running={statusQuery.isLoading}
            >
              {statusQuery.isLoading ? 'Checking' : 'Connected'}
            </StatusPill>
          </div>
          <div className="off-set-pv-meta">
            {accounts.length} API accounts · {orchestrationEngines.length} orchestration engines ·
            checked {checkedAtLabel(statusQuery.data?.checkedAt)}
          </div>
        </div>
        <Button
          variant="outline"
          size="md"
          disabled={!desktopAvailable || statusQuery.isFetching || accountingQuery.isFetching}
          onClick={() => void refreshAccounts()}
        >
          <Icon icon={RefreshCw} size="sm" />
          {statusQuery.isFetching || accountingQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </Button>
      </div>

      {statusQuery.isError ? (
        <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
          <Icon icon={TriangleAlert} size="sm" />
          AI engine status is unavailable. Refresh to retry.
        </div>
      ) : null}
      {!desktopAvailable ? (
        <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
          <Icon icon={Info} size="sm" />
          AI engine status is available inside the desktop app.
        </div>
      ) : null}

      <section className="off-set-account-section">
        <div className="off-set-sec-head">
          <CapsLabel>API engines</CapsLabel>
          <span>Usage, API cost, and exact models</span>
        </div>
        {accountingQuery.isError ? (
          <div className="off-set-callout is-warn">
            <Icon icon={TriangleAlert} size="sm" />
            API usage and cost history is unavailable. Refresh to retry.
          </div>
        ) : null}
        <section className="off-set-provider-console">
          <aside className="off-set-provider-list" aria-label="API accounts">
            <div className="off-set-provider-list-head">
              <CapsLabel>Accounts</CapsLabel>
              <span>{accounts.length}</span>
            </div>
            <div className="off-set-provider-nav-scroll">
              {accounts.map((account) => (
                <button
                  type="button"
                  key={account.accountId}
                  className={`off-set-provider-nav off-focusable ${selectedAccount?.accountId === account.accountId ? 'is-active' : ''}`}
                  onClick={() => setSelectedAccountId(account.accountId)}
                >
                  <span
                    className={`off-set-provider-dot ${account.status === 'available' ? 'is-ready' : 'is-muted'}`}
                  />
                  <span className="off-set-provider-nav-copy">
                    <span>{account.displayName}</span>
                    <small>API account</small>
                  </span>
                </button>
              ))}
              {!statusQuery.isLoading && !accounts.length ? (
                <div className="off-set-provider-empty">No API accounts configured.</div>
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
                      API account
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
                      {selectedAccount.usage
                        ? `${selectedAccount.usage.periodLabel}${selectedAccount.usage.updatedAt ? ` · updated ${checkedAtLabel(selectedAccount.usage.updatedAt)}` : ''}`
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
                    {models.map((model) => {
                      const detail = modelAvailabilityDetail(model);
                      return (
                        <div className="off-set-account-model" key={model.runtimeModelRef}>
                          <div className="off-set-account-model-copy">
                            <strong>{model.displayName}</strong>
                            <code>{model.modelId}</code>
                            {detail ? (
                              <span className="off-set-account-model-availability">{detail}</span>
                            ) : null}
                          </div>
                          <div className="off-set-account-model-limits">
                            <span>Context {formatLimit(model.contextWindow)}</span>
                            <span>Output {formatLimit(model.maxOutputTokens)}</span>
                          </div>
                          <StatusPill tone={modelAvailabilityTone(model)}>
                            {model.availability === 'expiring'
                              ? 'Expiring'
                              : model.availability === 'available'
                                ? 'Available'
                                : 'Unavailable'}
                          </StatusPill>
                        </div>
                      );
                    })}
                    {!models.length ? (
                      <div className="off-set-provider-empty">No exact API models reported.</div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <div className="off-set-provider-empty">
                {statusQuery.isLoading ? 'Loading API accounts…' : 'No API account is available.'}
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="off-set-account-section">
        <div className="off-set-sec-head">
          <CapsLabel>Orchestration engines</CapsLabel>
          <span>CLI-owned sign-in and model selection</span>
        </div>
        <div className="off-set-callout is-muted">
          <Icon icon={Info} size="sm" />
          Credentials stay inside each CLI. Offisim only checks installation, sign-in, and version.
        </div>
        {orchestrationEngines.map((engine) => (
          <OrchestrationEngineCard key={engine.engineId} engine={engine} />
        ))}
        {!statusQuery.isLoading && !orchestrationEngines.length ? (
          <div className="off-set-provider-empty">No orchestration engines reported.</div>
        ) : null}
      </section>
    </div>
  );
}
