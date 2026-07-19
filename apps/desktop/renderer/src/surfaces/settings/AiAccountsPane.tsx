import { isTauriRuntime } from '@/data/adapters.js';
import {
  type AccountCostSnapshot,
  type ApiUsageSnapshot,
  loadAiAccountUsage,
} from '@/data/ai-account-usage.js';
import { queryKeys } from '@/data/query-keys.js';
import { CapsLabel, StatusPill } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import {
  type CommandResult,
  type PiAgentProviderConfigInput,
  type PiAgentProviderConfigStatus,
  type PiAgentProviderModelConfig,
  type PiAgentProviderTemplate,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { openFirstRunGuide } from '@/surfaces/onboarding/first-run-state.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import type {
  AiAccountDescriptor,
  AiModelCatalogEntry,
  AiRuntimeStatus,
  OrchestrationEngineStatus,
} from '@offisim/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type PiAgentStatusResponse = CommandResult<'pi_agent_status'>;
type ProviderSelection = { mode: 'overview' } | { mode: 'add' } | { mode: 'edit'; id: string };

interface AccountView extends Omit<AiAccountDescriptor, 'usage'> {
  readonly usage?: ApiUsageSnapshot;
  readonly cost?: AccountCostSnapshot;
  readonly accountingStatus?: 'loading' | 'error';
}

interface RuntimeStatusView extends Omit<AiRuntimeStatus, 'accounts'> {
  readonly accounts: readonly AccountView[];
}

interface ProviderModelFormRow {
  readonly rowKey: string;
  readonly id: string;
  readonly name: string;
  readonly api: string;
  readonly contextWindow: string;
  readonly maxTokens: string;
}

interface ProviderFormState {
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly api: string;
  readonly apiKey: string;
  readonly keepExistingApiKey: boolean;
  readonly models: readonly ProviderModelFormRow[];
}

let providerModelRowSequence = 0;

function nextProviderModelRowKey(): string {
  providerModelRowSequence += 1;
  return `provider-model-${providerModelRowSequence}`;
}

function emptyModelRow(): ProviderModelFormRow {
  return {
    rowKey: nextProviderModelRowKey(),
    id: '',
    name: '',
    api: '',
    contextWindow: '',
    maxTokens: '',
  };
}

function initialProviderForm(): ProviderFormState {
  return {
    providerId: '',
    displayName: '',
    baseUrl: '',
    api: '',
    apiKey: '',
    keepExistingApiKey: false,
    models: [emptyModelRow()],
  };
}

function modelRowsFromConfig(
  models: readonly PiAgentProviderModelConfig[] | undefined,
): ProviderModelFormRow[] {
  const rows = (models ?? []).map((model) => ({
    rowKey: nextProviderModelRowKey(),
    id: model.id,
    name: model.name ?? '',
    api: model.api ?? '',
    contextWindow: model.contextWindow ? String(model.contextWindow) : '',
    maxTokens: model.maxTokens ? String(model.maxTokens) : '',
  }));
  return rows.length ? rows : [emptyModelRow()];
}

function positiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function serializeProviderForm(form: ProviderFormState): PiAgentProviderConfigInput {
  return {
    providerId: form.providerId.trim(),
    displayName: form.displayName.trim() || null,
    baseUrl: form.baseUrl.trim(),
    api: form.api.trim(),
    apiKey: form.apiKey.trim() || null,
    keepExistingApiKey: form.keepExistingApiKey,
    models: form.models
      .filter((model) => model.id.trim())
      .map((model) => ({
        id: model.id.trim(),
        ...(model.name.trim() ? { name: model.name.trim() } : {}),
        ...(model.api.trim() ? { api: model.api.trim() } : {}),
        ...(positiveNumber(model.contextWindow)
          ? { contextWindow: positiveNumber(model.contextWindow) }
          : {}),
        ...(positiveNumber(model.maxTokens) ? { maxTokens: positiveNumber(model.maxTokens) } : {}),
      })),
  };
}

function formFromProvider(
  config: PiAgentProviderConfigStatus,
  template?: PiAgentProviderTemplate,
): ProviderFormState {
  return {
    providerId: config.provider,
    displayName: config.name ?? config.displayName,
    baseUrl: config.baseUrl ?? template?.baseUrl ?? '',
    api: config.api ?? template?.api ?? '',
    apiKey: '',
    keepExistingApiKey: config.hasApiKey || Boolean(config.authSource),
    models: modelRowsFromConfig(config.models.length ? config.models : template?.models),
  };
}

function formFromTemplate(template: PiAgentProviderTemplate): ProviderFormState {
  return {
    providerId: template.provider,
    displayName: template.displayName,
    baseUrl: template.baseUrl ?? '',
    api: template.api ?? '',
    apiKey: '',
    keepExistingApiKey: false,
    models: modelRowsFromConfig(template.models),
  };
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
  if (!isRuntimeStatus(status)) throw new Error('The desktop runtime returned invalid AI status.');
  return status;
}

function checkedAtLabel(value?: string): string {
  if (!value) return 'not checked';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp,
  );
}

function compactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function usageHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (!account.usage) return 'No recorded usage';
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

function costHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.cost?.kind === 'unavailable') {
    return account.cost.knownAmountUsd === undefined
      ? 'Unavailable'
      : `$${account.cost.knownAmountUsd.toFixed(6)} known`;
  }
  if (!account.cost) return 'No recorded cost';
  const amount = `$${account.cost.amountUsd.toFixed(6)}`;
  return account.cost.kind === 'estimate' ? `~${amount}` : amount;
}

function modelAvailabilityTone(model: AiModelCatalogEntry) {
  if (model.availability === 'available') return 'ok' as const;
  if (model.availability === 'expiring') return 'warn' as const;
  return 'muted' as const;
}

function isModelRunnableNow(model: AiModelCatalogEntry) {
  if (model.availability === 'available') return true;
  if (model.availability !== 'expiring' || !model.expiresAt) return false;
  const expiresAt = Date.parse(model.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function FormField({
  label,
  htmlFor,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`off-set-provider-field${wide ? ' is-wide' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function ProviderModelsEditor({
  models,
  onChange,
}: {
  models: readonly ProviderModelFormRow[];
  onChange: (models: readonly ProviderModelFormRow[]) => void;
}) {
  const update = (index: number, patch: Partial<ProviderModelFormRow>) => {
    onChange(models.map((model, row) => (row === index ? { ...model, ...patch } : model)));
  };
  const remove = (index: number) => {
    const next = models.filter((_, row) => row !== index);
    onChange(next.length ? next : [emptyModelRow()]);
  };
  return (
    <div className="off-set-provider-model-editor">
      <div className="off-set-provider-model-editor-head">
        <CapsLabel>Models</CapsLabel>
        <Button variant="subtle" size="sm" onClick={() => onChange([...models, emptyModelRow()])}>
          <Icon icon={Plus} size="sm" /> Add model
        </Button>
      </div>
      <div className="off-set-provider-model-rows">
        {models.map((model, index) => (
          <div className="off-set-provider-model-row" key={model.rowKey}>
            <Input
              value={model.id}
              placeholder="Model id"
              aria-label="Model id"
              spellCheck={false}
              onChange={(event) => update(index, { id: event.currentTarget.value })}
            />
            <Input
              value={model.name}
              placeholder="Display name"
              aria-label="Model display name"
              onChange={(event) => update(index, { name: event.currentTarget.value })}
            />
            <Input
              value={model.api}
              placeholder="API override"
              aria-label="Model API override"
              spellCheck={false}
              onChange={(event) => update(index, { api: event.currentTarget.value })}
            />
            <Input
              value={model.contextWindow}
              placeholder="Context"
              aria-label="Context window"
              inputMode="numeric"
              onChange={(event) => update(index, { contextWindow: event.currentTarget.value })}
            />
            <Input
              value={model.maxTokens}
              placeholder="Max tokens"
              aria-label="Max tokens"
              inputMode="numeric"
              onChange={(event) => update(index, { maxTokens: event.currentTarget.value })}
            />
            <Button
              variant="subtle"
              size="icon"
              aria-label="Remove model"
              onClick={() => remove(index)}
            >
              <Icon icon={Trash2} size="sm" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiUsage({ account }: { account: AccountView }) {
  if (account.accountingStatus === 'loading')
    return <div className="off-set-callout is-muted">Loading API usage…</div>;
  if (account.accountingStatus === 'error')
    return (
      <div className="off-set-callout is-warn">
        <Icon icon={TriangleAlert} size="sm" />
        API usage is unavailable.
      </div>
    );
  if (!account.usage)
    return <div className="off-set-callout is-muted">No API usage recorded this month.</div>;
  const number = (value: number | undefined) =>
    value === undefined ? 'Unknown' : compactNumber(value);
  return (
    <div className="off-set-account-usage-grid">
      <div>
        <span>Input</span>
        <strong>{number(account.usage.inputTokens)}</strong>
      </div>
      <div>
        <span>Output</span>
        <strong>{number(account.usage.outputTokens)}</strong>
      </div>
      <div>
        <span>Cache read / write</span>
        <strong>
          {number(account.usage.cacheReadTokens)} / {number(account.usage.cacheWriteTokens)}
        </strong>
      </div>
      <div>
        <span>Reasoning</span>
        <strong>{number(account.usage.reasoningTokens)}</strong>
      </div>
    </div>
  );
}

function orchestrationStateLabel(state: OrchestrationEngineStatus['state']): string {
  if (state === 'ready') return 'Ready';
  if (state === 'not-installed') return 'Not installed';
  if (state === 'not-signed-in') return 'Not signed in';
  return 'Unavailable';
}

function QuietReadyState({ children }: { children: string }) {
  return (
    <span className="off-set-inline-state is-ready">
      <span /> {children}
    </span>
  );
}

function OrchestrationEngineCard({ engine }: { engine: OrchestrationEngineStatus }) {
  const [copied, setCopied] = useState(false);
  const docsUrl = useMemo(() => {
    try {
      const parsed = new URL(engine.docsUrl);
      return parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
      return null;
    }
  }, [engine.docsUrl]);
  const copyCommand = async () => {
    await navigator.clipboard.writeText(engine.loginCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="off-set-provider-runtime off-set-engine-card">
      <div className="off-set-pv-logo">
        <Icon icon={Terminal} size="md" />
      </div>
      <div className="min-w-0">
        <div className="off-set-pv-name">
          {engine.displayName}
          {engine.state === 'ready' ? (
            <QuietReadyState>Ready</QuietReadyState>
          ) : (
            <StatusPill tone={engine.state === 'unavailable' ? 'danger' : 'warn'}>
              {orchestrationStateLabel(engine.state)}
            </StatusPill>
          )}
        </div>
        <div className="off-set-pv-meta">
          {engine.version ? `Version ${engine.version} · ` : ''}Subscription included · No API cost
          · checked {checkedAtLabel(engine.checkedAt)}
        </div>
        {engine.statusReason ? <div className="off-set-pv-meta">{engine.statusReason}</div> : null}
      </div>
      <div className="off-set-engine-actions">
        {engine.state === 'not-signed-in' ? (
          <Button variant="outline" size="sm" onClick={() => void copyCommand()}>
            <Icon icon={copied ? Check : Copy} size="sm" />
            {copied ? 'Copied' : 'Copy login command'}
          </Button>
        ) : null}
        {docsUrl ? (
          <Button variant="outline" size="sm" asChild>
            <a href={docsUrl} target="_blank" rel="noreferrer">
              <Icon icon={ExternalLink} size="sm" />
              Official guide
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AiAccountsPane() {
  const desktopAvailable = isTauriRuntime();
  const queryClient = useQueryClient();
  const runtimeQuery = useQuery({
    queryKey: queryKeys.settingsAgentRuntimeStatus(),
    queryFn: loadRuntimeStatus,
    enabled: desktopAvailable,
    staleTime: 60_000,
    retry: false,
  });
  const providerQuery = useQuery({
    queryKey: queryKeys.settingsPiProviderConfig(),
    queryFn: () => invokeCommand('pi_agent_status'),
    enabled: desktopAvailable,
    staleTime: 60_000,
    retry: false,
  });
  const accountingQuery = useQuery({
    queryKey: queryKeys.settingsAiAccountUsage(),
    queryFn: loadAiAccountUsage,
    enabled: desktopAvailable,
    staleTime: 60_000,
    retry: false,
  });
  const [selection, setSelection] = useState<ProviderSelection>({ mode: 'overview' });
  const [form, setForm] = useState<ProviderFormState>(() => initialProviderForm());
  const [templateSearch, setTemplateSearch] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const loadedProviderRef = useRef<string | null>(null);
  const providerIdInputId = useId();
  const providerNameInputId = useId();
  const baseUrlInputId = useId();
  const apiInputId = useId();
  const apiKeyInputId = useId();

  const providerConfigs = providerQuery.data?.providerConfigs ?? [];
  const templates = providerQuery.data?.providerTemplates ?? [];
  const selectedProvider =
    selection.mode === 'edit'
      ? providerConfigs.find((provider) => provider.provider === selection.id)
      : undefined;
  const templateById = useMemo(
    () => new Map(templates.map((template) => [template.provider, template])),
    [templates],
  );
  const addableTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          !template.configured &&
          (!templateSearch.trim() ||
            `${template.provider} ${template.displayName} ${template.models.map((model) => model.id).join(' ')}`
              .toLowerCase()
              .includes(templateSearch.trim().toLowerCase())),
      ),
    [templateSearch, templates],
  );

  useEffect(() => {
    if (!selectedProvider || loadedProviderRef.current === selectedProvider.provider) return;
    loadedProviderRef.current = selectedProvider.provider;
    setForm(formFromProvider(selectedProvider, templateById.get(selectedProvider.provider)));
  }, [selectedProvider, templateById]);

  useEffect(() => {
    if (!providerQuery.data || providerConfigs.length || selection.mode !== 'overview') return;
    setSelection({ mode: 'add' });
  }, [providerConfigs.length, providerQuery.data, selection.mode]);

  const updateForm = <K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const showAddProvider = (template?: PiAgentProviderTemplate) => {
    loadedProviderRef.current = null;
    setForm(template ? formFromTemplate(template) : initialProviderForm());
    setSelection({ mode: 'add' });
  };
  const editProvider = (provider: PiAgentProviderConfigStatus) => {
    loadedProviderRef.current = null;
    setSelection({ mode: 'edit', id: provider.provider });
  };
  const saveProvider = async () => {
    const config = serializeProviderForm(form);
    if (!config.providerId || !config.baseUrl || !config.api || !config.models.length) {
      toast.error('Provider id, endpoint, API format, and at least one model id are required.');
      return;
    }
    if (!config.keepExistingApiKey && !config.apiKey) {
      toast.error('Enter the provider API key.');
      return;
    }
    setSavingProvider(true);
    try {
      const next = await invokeCommand('pi_agent_save_provider', { config });
      queryClient.setQueryData<PiAgentStatusResponse>(queryKeys.settingsPiProviderConfig(), next);
      setForm((current) => ({ ...current, apiKey: '', keepExistingApiKey: true }));
      setSelection({ mode: 'edit', id: config.providerId });
      loadedProviderRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settingsAgentRuntimeStatus() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agentRuntimeModels() }),
      ]);
      toast.success('Provider saved to Pi models.json.');
    } catch (error) {
      toast.error('Provider save failed', { description: safeErrorMessage(error) });
    } finally {
      setSavingProvider(false);
    }
  };

  const accountingByAccount = useMemo(
    () =>
      new Map(
        (accountingQuery.data ?? []).map((snapshot) => [snapshot.accountId, snapshot] as const),
      ),
    [accountingQuery.data],
  );
  const apiAccounts: AccountView[] = (runtimeQuery.data?.accounts ?? [])
    .filter((account) => account.engineId === 'api' && account.billingMode === 'api')
    .map((account) => {
      const accounting = accountingByAccount.get(account.accountId);
      return {
        ...account,
        ...(accounting ? { usage: accounting.usage, cost: accounting.cost } : {}),
        ...(accountingQuery.isLoading
          ? { accountingStatus: 'loading' as const }
          : accountingQuery.isError
            ? { accountingStatus: 'error' as const }
            : {}),
      };
    });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (!apiAccounts.length) setSelectedAccountId(null);
    else if (!apiAccounts.some((account) => account.accountId === selectedAccountId))
      setSelectedAccountId(apiAccounts[0]?.accountId ?? null);
  }, [apiAccounts, selectedAccountId]);
  const selectedAccount =
    apiAccounts.find((account) => account.accountId === selectedAccountId) ?? apiAccounts[0];
  const selectedModels = (runtimeQuery.data?.models ?? []).filter(
    (model) => model.engineId === 'api' && model.accountId === selectedAccount?.accountId,
  );
  const orchestrationEngines = runtimeQuery.data?.orchestrationEngines ?? [];
  const hasRunnableApiModel = (runtimeQuery.data?.models ?? []).some(
    (model) =>
      model.engineId === 'api' &&
      isModelRunnableNow(model) &&
      apiAccounts.some(
        (account) =>
          account.accountId === model.accountId &&
          account.status === 'available' &&
          account.capabilities.execute.status === 'available' &&
          account.capabilities.models.status === 'available',
      ),
  );
  const refreshing =
    runtimeQuery.isFetching || providerQuery.isFetching || accountingQuery.isFetching;
  const pageState = refreshing
    ? 'checking'
    : runtimeQuery.isError
      ? 'failed'
      : providerQuery.isError || accountingQuery.isError
        ? 'attention'
        : 'ready';
  const refresh = async () => {
    await Promise.all([runtimeQuery.refetch(), providerQuery.refetch(), accountingQuery.refetch()]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.agentRuntimeModels() });
  };

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">AI Accounts</div>
        <div className="off-set-panedesc">
          Connect pay-as-you-go API providers or use coding tools from your existing subscriptions.
        </div>
      </div>
      <div className="off-set-provider-runtime">
        <div className="off-set-pv-logo">
          <Icon icon={Bot} size="md" />
        </div>
        <div className="min-w-0">
          <div className="off-set-pv-name">
            API engines
            {pageState === 'ready' ? (
              <QuietReadyState>Up to date</QuietReadyState>
            ) : (
              <StatusPill
                tone={
                  pageState === 'checking' ? 'accent' : pageState === 'failed' ? 'danger' : 'warn'
                }
                running={pageState === 'checking'}
              >
                {pageState === 'checking'
                  ? 'Checking'
                  : pageState === 'failed'
                    ? 'Unavailable'
                    : 'Needs attention'}
              </StatusPill>
            )}
          </div>
          <div className="off-set-pv-meta">
            {providerQuery.isError
              ? 'API provider status unavailable'
              : `${providerConfigs.length} API ${providerConfigs.length === 1 ? 'provider' : 'providers'}`}{' '}
            ·{' '}
            {runtimeQuery.isError
              ? 'subscription tool status unavailable'
              : `${orchestrationEngines.length} subscription ${orchestrationEngines.length === 1 ? 'tool' : 'tools'}`}{' '}
            · checked {checkedAtLabel(runtimeQuery.data?.checkedAt)}
          </div>
        </div>
        <Button
          variant="outline"
          size="md"
          disabled={!desktopAvailable || refreshing || savingProvider}
          onClick={() => void refresh()}
        >
          <Icon icon={RefreshCw} size="sm" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </Button>
      </div>
      {!desktopAvailable ? (
        <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
          <Icon icon={Info} size="sm" />
          AI settings are available inside the desktop app.
        </div>
      ) : null}
      {pageState === 'failed' || pageState === 'attention' ? (
        <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
          <Icon icon={TriangleAlert} size="sm" />
          {pageState === 'failed'
            ? "Offisim couldn't check API providers or subscription tools. Refresh to try again."
            : "Some account details couldn't be checked. Available settings remain usable; refresh to retry."}
        </div>
      ) : null}
      {!runtimeQuery.isLoading &&
      !runtimeQuery.isError &&
      !hasRunnableApiModel &&
      !orchestrationEngines.some((engine) => engine.state === 'ready') ? (
        <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
          <Icon icon={Info} size="sm" />
          <span>
            No engine is ready. Sign in to a detected coding tool, or add a Pi API provider below.
          </span>
          <Button variant="outline" size="sm" onClick={openFirstRunGuide}>
            Resume setup guide
          </Button>
        </div>
      ) : null}

      <section className="off-set-account-section">
        <div className="off-set-sec-head">
          <CapsLabel>API providers</CapsLabel>
          <span>Add providers and choose the exact models available to employees.</span>
        </div>
        <section className="off-set-provider-card">
          <div className="off-set-provider-detail">
            {selection.mode === 'overview' ? (
              <div className="off-set-provider-form">
                <div className="off-set-provider-detail-head">
                  <div>
                    <h3>Configured providers</h3>
                    <p>Saved API keys stay private and are never shown again.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => showAddProvider()}>
                    <Icon icon={Plus} size="sm" />
                    Add provider
                  </Button>
                </div>
                <div className="off-set-provider-overview">
                  {providerQuery.isError ? (
                    <div className="off-set-provider-empty">
                      Couldn't load configured providers. Refresh to check again.
                    </div>
                  ) : null}
                  {providerConfigs.map((provider) => (
                    <div className="off-set-provider-overview-row" key={provider.provider}>
                      <span
                        className={`off-set-provider-dot ${provider.hasApiKey || provider.authSource ? 'is-ready' : 'is-muted'}`}
                      />
                      <span className="off-set-provider-overview-copy">
                        <strong>{provider.displayName}</strong>
                        <small>{provider.provider}</small>
                      </span>
                      <span className="off-set-provider-overview-meta">
                        {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}{' '}
                        · {provider.api ?? 'Format not set'} ·{' '}
                        {provider.hasApiKey || provider.authSource ? 'Key saved' : 'Key needed'}
                      </span>
                      <span className="off-set-provider-row-actions">
                        {provider.hasApiKey || provider.authSource ? null : (
                          <StatusPill tone="warn">Needs key</StatusPill>
                        )}
                        <Button variant="subtle" size="sm" onClick={() => editProvider(provider)}>
                          <Icon icon={Pencil} size="sm" />
                          Edit
                        </Button>
                      </span>
                    </div>
                  ))}
                  {!providerQuery.isLoading && !providerQuery.isError && !providerConfigs.length ? (
                    <EmptyState
                      className="is-compact"
                      icon={Bot}
                      title="No API providers yet"
                      description="Add one to make its models available to employees."
                    />
                  ) : null}
                </div>
              </div>
            ) : runtimeQuery.isError || accountingQuery.isError ? (
              <div className="off-set-provider-empty">
                Couldn't check API account activity. Refresh to try again.
              </div>
            ) : (
              <div className="off-set-provider-form">
                <div className="off-set-provider-detail-head">
                  <div>
                    {providerConfigs.length ? (
                      <button
                        type="button"
                        className="off-set-provider-back off-focusable"
                        onClick={() => setSelection({ mode: 'overview' })}
                      >
                        <Icon icon={ArrowLeft} size="sm" />
                        All providers
                      </button>
                    ) : null}
                    <h3>
                      {selection.mode === 'add'
                        ? 'Add API provider'
                        : (selectedProvider?.displayName ?? 'Edit provider')}
                    </h3>
                    <p>
                      The endpoint, model IDs, and key are saved in your local Pi configuration.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void invokeCommand('pi_agent_open_config_folder').catch((error) =>
                        toast.error('Open config failed', { description: safeErrorMessage(error) }),
                      )
                    }
                  >
                    <Icon icon={FolderOpen} size="sm" />
                    Open Pi config
                  </Button>
                </div>
                <div className="off-set-provider-form-grid">
                  <FormField label="Provider ID" htmlFor={providerIdInputId}>
                    <Input
                      id={providerIdInputId}
                      value={form.providerId}
                      disabled={selection.mode === 'edit'}
                      placeholder="my-provider"
                      spellCheck={false}
                      onChange={(event) => updateForm('providerId', event.currentTarget.value)}
                    />
                  </FormField>
                  <FormField label="Display name" htmlFor={providerNameInputId}>
                    <Input
                      id={providerNameInputId}
                      value={form.displayName}
                      placeholder="My provider"
                      onChange={(event) => updateForm('displayName', event.currentTarget.value)}
                    />
                  </FormField>
                  <FormField label="Base URL" htmlFor={baseUrlInputId} wide>
                    <Input
                      id={baseUrlInputId}
                      value={form.baseUrl}
                      placeholder="https://api.example.com/v1"
                      spellCheck={false}
                      onChange={(event) => updateForm('baseUrl', event.currentTarget.value)}
                    />
                  </FormField>
                  <FormField label="API format" htmlFor={apiInputId}>
                    <Input
                      id={apiInputId}
                      value={form.api}
                      placeholder="openai-completions"
                      spellCheck={false}
                      onChange={(event) => updateForm('api', event.currentTarget.value)}
                    />
                  </FormField>
                  <FormField
                    label={form.keepExistingApiKey ? 'Replace API key' : 'API key'}
                    htmlFor={apiKeyInputId}
                    wide
                  >
                    <Input
                      id={apiKeyInputId}
                      type="password"
                      value={form.apiKey}
                      placeholder={
                        form.keepExistingApiKey
                          ? 'Leave blank to keep the stored key'
                          : 'Paste provider API key'
                      }
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => updateForm('apiKey', event.currentTarget.value)}
                    />
                  </FormField>
                </div>
                <details className="off-set-disclosure" open={selection.mode === 'add'}>
                  <summary>
                    <span className="off-set-chev">
                      <Icon icon={ChevronRight} size="sm" />
                    </span>
                    Models{' '}
                    <span className="off-set-provider-disc-count">
                      {form.models.filter((model) => model.id.trim()).length}
                    </span>
                  </summary>
                  <div className="off-set-disclosure-body">
                    <ProviderModelsEditor
                      models={form.models}
                      onChange={(models) => updateForm('models', models)}
                    />
                  </div>
                </details>
                <div className="off-set-provider-form-actions">
                  <Button
                    disabled={!desktopAvailable || savingProvider}
                    onClick={() => void saveProvider()}
                  >
                    {savingProvider
                      ? 'Saving…'
                      : selection.mode === 'add'
                        ? 'Save provider'
                        : 'Save changes'}
                  </Button>
                </div>
                {selection.mode === 'add' ? (
                  <div className="off-set-provider-template-panel">
                    <div className="off-set-provider-template-head">
                      <CapsLabel>Provider templates</CapsLabel>
                      <div className="off-set-provider-template-search">
                        <Icon icon={Search} size="sm" />
                        <Input
                          value={templateSearch}
                          placeholder="Search templates"
                          aria-label="Search provider templates"
                          onChange={(event) => setTemplateSearch(event.currentTarget.value)}
                        />
                      </div>
                    </div>
                    <div className="off-set-provider-template-list">
                      {addableTemplates.length ? (
                        addableTemplates.map((template) => (
                          <button
                            type="button"
                            key={template.provider}
                            className="off-set-provider-template off-focusable"
                            onClick={() => showAddProvider(template)}
                          >
                            <span>
                              <strong>{template.displayName}</strong>
                              <small>{template.provider}</small>
                            </span>
                            <em>{template.models[0]?.id ?? template.api ?? 'custom endpoint'}</em>
                          </button>
                        ))
                      ) : (
                        <div className="off-set-provider-empty">
                          No matching template. Enter a custom provider above.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <div className="off-set-sec-head">
          <CapsLabel>API account activity</CapsLabel>
          <span>Usage and pay-as-you-go cost from completed API tasks.</span>
        </div>
        <section className="off-set-provider-card">
          {apiAccounts.length > 1 ? (
            <div className="off-set-account-switcher" aria-label="API accounts">
              {apiAccounts.map((account) => (
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
                    <small>
                      {account.status === 'available' ? 'Available' : 'Needs attention'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="off-set-provider-detail">
            {selectedAccount ? (
              <>
                <div className="off-set-provider-detail-head">
                  <div>
                    <h3>{selectedAccount.displayName}</h3>
                    <p>
                      {selectedAccount.statusReason ?? 'Usage and cost for completed API tasks'}
                    </p>
                  </div>
                  {selectedAccount.status === 'available' ? (
                    <QuietReadyState>Available</QuietReadyState>
                  ) : (
                    <StatusPill tone="danger">Unavailable</StatusPill>
                  )}
                </div>
                <div className="off-set-provider-summary-grid">
                  <div>
                    <span>Models</span>
                    <strong>{selectedModels.length}</strong>
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
                  </div>
                  <ApiUsage account={selectedAccount} />
                </section>
                <section className="off-set-account-section">
                  <div className="off-set-sec-head">
                    <CapsLabel>Models</CapsLabel>
                    <span>{selectedModels.length}</span>
                  </div>
                  <div className="off-set-account-models">
                    {selectedModels.map((model) => (
                      <div className="off-set-account-model" key={model.runtimeModelRef}>
                        <div className="off-set-account-model-copy">
                          <strong>{model.displayName}</strong>
                          <code>{model.modelId}</code>
                        </div>
                        {model.availability === 'available' ? null : (
                          <StatusPill tone={modelAvailabilityTone(model)}>
                            {model.availability}
                          </StatusPill>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <EmptyState
                className="is-compact"
                icon={Info}
                title="No API activity yet"
                description="Add a provider above, then run a task to see usage here."
              />
            )}
          </div>
        </section>
      </section>

      <section className="off-set-account-section">
        <div className="off-set-sec-head">
          <CapsLabel>Subscription tools</CapsLabel>
          <span>Use Codex or Claude Code with the subscription you already have.</span>
        </div>
        <div className="off-set-callout is-muted">
          <Icon icon={Info} size="sm" />
          Sign-in and model choices stay inside each tool. Offisim only checks whether it is ready.
        </div>
        {orchestrationEngines.map((engine) => (
          <OrchestrationEngineCard key={engine.engineId} engine={engine} />
        ))}
        {!runtimeQuery.isLoading && !runtimeQuery.isError && !orchestrationEngines.length ? (
          <div className="off-set-provider-empty">
            No supported subscription tools were detected. Refresh to check again.
          </div>
        ) : null}
      </section>
    </div>
  );
}
