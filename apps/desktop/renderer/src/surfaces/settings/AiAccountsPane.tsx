import { isTauriRuntime } from '@/data/adapters.js';
import {
  type AccountCostSnapshot,
  type ApiUsageSnapshot,
  loadAiAccountUsage,
} from '@/data/ai-account-usage.js';
import { queryKeys } from '@/data/query-keys.js';
import { formatAmount } from '@/data/run-cost.js';
import { EngineMark, engineKindFromId } from '@/design-system/grammar/EngineMark.js';
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
import type {
  AiAccountDescriptor,
  AiModelCatalogEntry,
  AiRuntimeStatus,
  OrchestrationEngineStatus,
} from '@offisim/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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

function costHeadline(account: AccountView): string {
  if (account.accountingStatus === 'loading') return 'Loading';
  if (account.accountingStatus === 'error') return 'Unavailable';
  if (account.cost?.kind === 'unavailable') {
    return account.cost.knownAmountUsd === undefined
      ? 'Unavailable'
      : `${formatAmount(account.cost.knownAmountUsd)} known`;
  }
  if (!account.cost) return 'No recorded cost';
  const amount = formatAmount(account.cost.amountUsd);
  return account.cost.kind === 'estimate' ? `~${amount}` : amount;
}

/** API account ids are namespaced as `api:<providerId>:<hash>` — the middle
 *  segment ties a runtime account back to its configured provider. */
function accountProviderId(account: AccountView): string | null {
  const segments = account.accountId.split(':');
  return segments.length >= 2 && segments[1] ? segments[1] : null;
}

/** Compact activity facts for a provider row — only fields we actually know. */
function providerActivityMeta(account: AccountView | undefined): string | null {
  if (!account) return null;
  if (account.accountingStatus === 'loading') return 'Checking activity…';
  if (account.accountingStatus === 'error') return 'Activity unavailable';
  const parts: string[] = [];
  if (account.usage) {
    parts.push(`${account.usage.runCount} ${account.usage.runCount === 1 ? 'run' : 'runs'}`);
    const buckets = [
      account.usage.inputTokens,
      account.usage.outputTokens,
      account.usage.cacheReadTokens,
      account.usage.cacheWriteTokens,
    ].filter((value): value is number => value !== undefined);
    if (buckets.length) {
      parts.push(`${compactNumber(buckets.reduce((sum, value) => sum + value, 0))} tokens`);
    }
  }
  if (account.cost) {
    if (account.cost.kind === 'unavailable') {
      if (account.cost.knownAmountUsd !== undefined) {
        parts.push(`${formatAmount(account.cost.knownAmountUsd)} known`);
      }
    } else {
      const amount = formatAmount(account.cost.amountUsd);
      parts.push(account.cost.kind === 'estimate' ? `~${amount}` : amount);
    }
  }
  return parts.length ? parts.join(' · ') : null;
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
  // Only render fields the provider actually reported — unknown buckets never
  // become empty "Unknown" tiles. A single note flags partial coverage.
  const cells: { label: string; value: string }[] = [];
  if (account.usage.inputTokens !== undefined)
    cells.push({ label: 'Input', value: compactNumber(account.usage.inputTokens) });
  if (account.usage.outputTokens !== undefined)
    cells.push({ label: 'Output', value: compactNumber(account.usage.outputTokens) });
  if (account.usage.cacheReadTokens !== undefined)
    cells.push({ label: 'Cache read', value: compactNumber(account.usage.cacheReadTokens) });
  if (account.usage.cacheWriteTokens !== undefined)
    cells.push({ label: 'Cache write', value: compactNumber(account.usage.cacheWriteTokens) });
  if (account.usage.reasoningTokens !== undefined)
    cells.push({ label: 'Reasoning', value: compactNumber(account.usage.reasoningTokens) });
  const partial =
    account.usage.inputTokens === undefined ||
    account.usage.outputTokens === undefined ||
    account.usage.cacheReadTokens === undefined ||
    account.usage.cacheWriteTokens === undefined ||
    account.usage.reasoningTokens === undefined;
  if (!cells.length)
    return (
      <div className="off-set-callout is-muted">
        {account.usage.runCount > 0
          ? `${account.usage.runCount} ${account.usage.runCount === 1 ? 'run' : 'runs'} completed · token detail not reported`
          : 'No API usage recorded this month.'}
      </div>
    );
  return (
    <>
      <div className="off-set-account-usage-grid">
        {cells.map((cell) => (
          <div key={cell.label}>
            <span>{cell.label}</span>
            <strong>{cell.value}</strong>
          </div>
        ))}
      </div>
      {partial ? (
        <p className="off-set-pv-meta">Some usage fields weren&apos;t reported for this period.</p>
      ) : null}
    </>
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
      <EngineMark
        engine={engineKindFromId(engine.engineId, engine.displayName)}
        size={32}
        label={engine.displayName}
      />
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
        {engine.version ? <div className="off-set-pv-meta">Version {engine.version}</div> : null}
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
  // Provider cards merge configuration and activity: each configured provider
  // is matched to its runtime account (api:<provider>:<hash>) so usage, cost,
  // and the runnable model list expand inline — no separate activity section.
  const accountsByProvider = useMemo(() => {
    const map = new Map<string, AccountView>();
    for (const account of apiAccounts) {
      const providerId = accountProviderId(account);
      if (providerId && !map.has(providerId)) map.set(providerId, account);
    }
    return map;
  }, [apiAccounts]);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const runtimeModels = runtimeQuery.data?.models ?? [];
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
  // Single visible busy signal: before the first successful check the panehead
  // meta owns it ("Checking…"); afterwards the refresh button owns it
  // ("Refreshing…") while the meta keeps showing the last checked time.
  const initialChecking = refreshing && !runtimeQuery.data;
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
      <div className="off-set-panehead off-set-panehead-row">
        <div className="min-w-0">
          <div className="off-set-panetitle">AI Accounts</div>
          <div className="off-set-panedesc">
            Connect pay-as-you-go API providers or use coding tools from your existing
            subscriptions.
          </div>
        </div>
        <div className="off-set-panehead-aside">
          <span className="off-set-panehead-meta">
            {initialChecking
              ? 'Checking…'
              : `Checked ${checkedAtLabel(runtimeQuery.data?.checkedAt)}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktopAvailable || refreshing || savingProvider}
            onClick={() => void refresh()}
          >
            <Icon icon={RefreshCw} size="sm" className={refreshing ? 'off-spin' : undefined} />
            {refreshing && !initialChecking ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
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
          <div>
            <CapsLabel>Subscription engines</CapsLabel>
            <div className="off-set-sec-hint">
              Use Codex or Claude Code with the subscription you already have.
            </div>
          </div>
        </div>
        <div className="off-set-callout is-muted">
          <Icon icon={Info} size="sm" />
          {
            'Sign-in, model choices, and billing stay inside each tool — subscription included, no API cost.'
          }
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

      <section className="off-set-account-section">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>API providers</CapsLabel>
            <div className="off-set-sec-hint">
              Add providers and choose the exact models available to employees.
            </div>
          </div>
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
                      Couldn&apos;t load configured providers. Refresh to check again.
                    </div>
                  ) : null}
                  {providerConfigs.map((provider) => {
                    const account = accountsByProvider.get(provider.provider);
                    const accountModels = account
                      ? runtimeModels.filter(
                          (model) =>
                            model.engineId === 'api' && model.accountId === account.accountId,
                        )
                      : [];
                    const activityMeta = providerActivityMeta(account);
                    const expanded = expandedProviderId === provider.provider;
                    return (
                      <div
                        className={`off-set-provider-overview-row is-merged ${expanded ? 'is-expanded' : ''}`}
                        key={provider.provider}
                      >
                        <div className="off-set-provider-merged-head">
                          <span
                            className={`off-set-provider-dot ${provider.hasApiKey || provider.authSource ? 'is-ready' : 'is-muted'}`}
                          />
                          <span className="off-set-provider-overview-copy">
                            <strong>{provider.displayName}</strong>
                            {provider.displayName !== provider.provider ? (
                              <small>{provider.provider}</small>
                            ) : null}
                          </span>
                          <span className="off-set-provider-overview-meta">
                            {provider.models.length}{' '}
                            {provider.models.length === 1 ? 'model' : 'models'} ·{' '}
                            {provider.api ?? 'Format not set'} ·{' '}
                            {provider.hasApiKey || provider.authSource ? 'Key saved' : 'Key needed'}
                            {activityMeta ? ` · ${activityMeta}` : ''}
                          </span>
                          <span className="off-set-provider-row-actions">
                            {provider.hasApiKey || provider.authSource ? null : (
                              <StatusPill tone="warn">Needs key</StatusPill>
                            )}
                            {account ? (
                              account.status === 'available' ? (
                                <QuietReadyState>Available</QuietReadyState>
                              ) : (
                                <StatusPill tone="danger">Unavailable</StatusPill>
                              )
                            ) : null}
                            <Button
                              variant="subtle"
                              size="sm"
                              onClick={() => editProvider(provider)}
                            >
                              <Icon icon={Pencil} size="sm" />
                              Edit
                            </Button>
                            <Button
                              variant="subtle"
                              size="iconSm"
                              aria-expanded={expanded}
                              aria-label={
                                expanded
                                  ? `Hide usage and models for ${provider.displayName}`
                                  : `Show usage and models for ${provider.displayName}`
                              }
                              onClick={() =>
                                setExpandedProviderId(expanded ? null : provider.provider)
                              }
                            >
                              <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" />
                            </Button>
                          </span>
                        </div>
                        {expanded ? (
                          <div className="off-set-provider-merged-body">
                            {account?.statusReason ? (
                              <p className="off-set-pv-meta">{account.statusReason}</p>
                            ) : null}
                            {account ? (
                              <>
                                <div className="off-set-provider-merged-usage">
                                  <ApiUsage account={account} />
                                  {account.cost ? (
                                    <p className="off-set-pv-meta">
                                      Cost this period: {costHeadline(account)}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="off-set-account-models">
                                  {accountModels.length ? (
                                    accountModels.map((model) => (
                                      <div
                                        className="off-set-account-model"
                                        key={model.runtimeModelRef}
                                      >
                                        <div className="off-set-account-model-copy">
                                          <strong>{model.displayName}</strong>
                                          {model.modelId !== model.displayName ? (
                                            <code>{model.modelId}</code>
                                          ) : null}
                                        </div>
                                        {model.availability === 'available' ? null : (
                                          <StatusPill tone={modelAvailabilityTone(model)}>
                                            {model.availability}
                                          </StatusPill>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="off-set-provider-empty">
                                      No runnable models reported for this provider.
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="off-set-provider-empty">
                                No runtime activity for this provider yet — run a task to see usage
                                here.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!providerQuery.isLoading && !providerQuery.isError && !providerConfigs.length ? (
                    <div className="off-set-provider-empty">
                      No API providers yet. Add one to make its models available to employees.
                    </div>
                  ) : null}
                </div>
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
      </section>
    </div>
  );
}
