import { isTauriRuntime } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { CapsLabel, StatusPill } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { readPiModelOverride, writePiModelOverride } from '@/runtime/pi-agent-config.js';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Copy,
  FolderOpen,
  Info,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

let providerModelRowSeq = 0;

type ProviderSelection = { mode: 'none' } | { mode: 'add' } | { mode: 'edit'; provider: string };

interface ProviderModelRowSource {
  id?: string;
  name?: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

function nextProviderModelRowKey() {
  providerModelRowSeq += 1;
  return `provider-model-${providerModelRowSeq}`;
}

interface PiAgentAuthStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

interface PiAgentAuthAccountStatus {
  provider: string;
  displayName: string;
  auth: PiAgentAuthStatus;
}

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

interface PiAgentProviderModelConfig {
  id: string;
  name?: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

interface PiAgentProviderConfigStatus {
  provider: string;
  displayName: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  hasApiKey?: boolean;
  authSource?: string;
  models?: PiAgentProviderModelConfig[];
}

interface PiAgentProviderTemplate {
  provider: string;
  displayName: string;
  baseUrl?: string;
  api?: string;
  configured?: boolean;
  models?: PiAgentProviderModelConfig[];
}

interface PiAgentStatusResponse {
  ok: boolean;
  authProviders: string[];
  providerStatus: PiAgentAuthAccountStatus[];
  configuredProviderStatus?: PiAgentAuthAccountStatus[];
  providerConfigs?: PiAgentProviderConfigStatus[];
  providerTemplates?: PiAgentProviderTemplate[];
  availableModels: PiAgentModelSummary[];
  allModelCount: number;
  paths?: {
    agentDir?: string;
    authPath?: string;
    modelsPath?: string;
  };
  modelsConfig?: {
    path?: string;
    exists: boolean;
    providerCount: number;
    modelCount: number;
    providers: string[];
    parseError?: string;
  };
  checkedAt?: string;
}

interface ProviderModelFormRow {
  rowKey: string;
  id: string;
  name: string;
  api: string;
  contextWindow: string;
  maxTokens: string;
}

interface SerializedProviderModelRow {
  id: string;
  name: string | null;
  api: string | null;
  contextWindow: number | null;
  maxTokens: number | null;
}

interface ProviderFormState {
  providerId: string;
  displayName: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  keepExistingApiKey: boolean;
  models: ProviderModelFormRow[];
}

// Pure, render-safe fallback for reading the first model row's fields when the
// form somehow holds no rows. Unlike emptyModelRow() it allocates no rowKey and
// does not mutate the module sequence, so it is safe to reference during render.
const EMPTY_MODEL_FIELDS: Omit<ProviderModelFormRow, 'rowKey'> = {
  id: '',
  name: '',
  api: '',
  contextWindow: '',
  maxTokens: '',
};

function emptyModelRow(): ProviderModelFormRow {
  return {
    rowKey: nextProviderModelRowKey(),
    ...EMPTY_MODEL_FIELDS,
  };
}

function initialProviderForm(): ProviderFormState {
  return {
    providerId: '',
    displayName: '',
    baseUrl: '',
    api: 'openai-completions',
    apiKey: '',
    keepExistingApiKey: false,
    models: [emptyModelRow()],
  };
}

async function loadPiAgentStatus(): Promise<PiAgentStatusResponse> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PiAgentStatusResponse>('pi_agent_status');
}

async function openPiConfigFolder(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pi_agent_open_config_folder');
}

async function savePiProvider(
  config: ProviderFormState,
  models: SerializedProviderModelRow[],
): Promise<PiAgentStatusResponse> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PiAgentStatusResponse>('pi_agent_save_provider', {
    config: {
      providerId: config.providerId,
      displayName: config.displayName || null,
      baseUrl: config.baseUrl,
      api: config.api,
      apiKey: config.apiKey || null,
      keepExistingApiKey: config.keepExistingApiKey,
      models,
    },
  });
}

function checkedAtLabel(checkedAt?: string): string {
  if (!checkedAt) return 'Not checked';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(checkedAt));
}

function modelLabel(model: PiAgentModelSummary): string {
  const id = model.id ?? model.name ?? 'model';
  return model.provider ? `${model.provider}/${id}` : id;
}

function copyLabel(text?: string): string {
  if (!text) return 'Unavailable';
  return text.replace(/^\/Users\/[^/]+/u, '~');
}

function authSourceLabel(source?: string): string {
  switch (source) {
    case 'models_json_key':
      return 'models.json key';
    case 'models_json_command':
      return 'models.json command';
    case 'stored':
      return 'auth.json';
    case 'env':
      return 'environment';
    default:
      return source ?? 'not configured';
  }
}

function providerSort(a: PiAgentAuthAccountStatus, b: PiAgentAuthAccountStatus) {
  if (a.auth.configured !== b.auth.configured) return a.auth.configured ? -1 : 1;
  return a.displayName.localeCompare(b.displayName);
}

function modelRowsFromModels(models: ProviderModelRowSource[] | undefined) {
  const rows =
    models
      ?.map((model) => ({
        rowKey: nextProviderModelRowKey(),
        id: model.id ?? '',
        name: model.name ?? '',
        api: model.api ?? '',
        contextWindow: model.contextWindow ? String(model.contextWindow) : '',
        maxTokens: model.maxTokens ? String(model.maxTokens) : '',
      }))
      .filter((model) => model.id.trim()) ?? [];
  return rows.length ? rows : [emptyModelRow()];
}

function positiveNumber(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function serializeModelRows(models: ProviderModelFormRow[]): SerializedProviderModelRow[] {
  return models
    .map((model) => {
      const id = model.id.trim();
      if (!id) return null;
      return {
        id,
        name: model.name.trim() || null,
        api: model.api.trim() || null,
        contextWindow: positiveNumber(model.contextWindow) ?? null,
        maxTokens: positiveNumber(model.maxTokens) ?? null,
      };
    })
    .filter((model): model is SerializedProviderModelRow => Boolean(model));
}

function templateMatches(template: PiAgentProviderTemplate, query: string) {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return (
    template.provider.toLowerCase().includes(needle) ||
    template.displayName.toLowerCase().includes(needle) ||
    template.models?.some(
      (model) =>
        model.id.toLowerCase().includes(needle) || model.name?.toLowerCase().includes(needle),
    )
  );
}

async function copyText(text: string | undefined, label: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch (err) {
    toast.error(`${label} copy failed`, { description: safeErrorMessage(err) });
  }
}

function FormField({
  label,
  htmlFor,
  wide,
  children,
}: {
  label: string;
  htmlFor?: string;
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
  models: ProviderModelFormRow[];
  onChange: (models: ProviderModelFormRow[]) => void;
}) {
  function updateRow(index: number, patch: Partial<ProviderModelFormRow>) {
    onChange(models.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    const next = models.filter((_, rowIndex) => rowIndex !== index);
    onChange(next.length ? next : [emptyModelRow()]);
  }

  return (
    <div className="off-set-provider-model-editor">
      <div className="off-set-provider-model-editor-head">
        <CapsLabel>Model list</CapsLabel>
        <Button variant="subtle" size="sm" onClick={() => onChange([...models, emptyModelRow()])}>
          <Icon icon={Plus} size="sm" />
          Add model
        </Button>
      </div>
      <div className="off-set-provider-model-rows">
        {models.map((model, index) => (
          <div className="off-set-provider-model-row" key={model.rowKey}>
            <Input
              value={model.id}
              placeholder="model id"
              spellCheck={false}
              aria-label="Model id"
              onChange={(event) => updateRow(index, { id: event.currentTarget.value })}
            />
            <Input
              value={model.name}
              placeholder="Display name"
              aria-label="Model display name"
              onChange={(event) => updateRow(index, { name: event.currentTarget.value })}
            />
            <Input
              value={model.api}
              placeholder="API override"
              spellCheck={false}
              aria-label="Model API override"
              onChange={(event) => updateRow(index, { api: event.currentTarget.value })}
            />
            <Input
              value={model.contextWindow}
              inputMode="numeric"
              placeholder="Context"
              spellCheck={false}
              aria-label="Context window"
              onChange={(event) => updateRow(index, { contextWindow: event.currentTarget.value })}
            />
            <Input
              value={model.maxTokens}
              inputMode="numeric"
              placeholder="Max tokens"
              spellCheck={false}
              aria-label="Max tokens"
              onChange={(event) => updateRow(index, { maxTokens: event.currentTarget.value })}
            />
            <Button
              variant="subtle"
              size="icon"
              aria-label="Remove model"
              onClick={() => removeRow(index)}
            >
              <Icon icon={Trash2} size="sm" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PiAgentPane() {
  const modelOverrideInputId = useId();
  const providerIdInputId = useId();
  const providerNameInputId = useId();
  const baseUrlInputId = useId();
  const apiSelectId = useId();
  const apiKeyInputId = useId();
  const initialModelInputId = useId();
  const contextWindowInputId = useId();
  const maxTokensInputId = useId();
  const modelApiInputId = useId();
  const [status, setStatus] = useState<PiAgentStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedProviderRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<ProviderSelection>({ mode: 'none' });
  const [templateSearch, setTemplateSearch] = useState('');
  const [form, setForm] = useState<ProviderFormState>(() => initialProviderForm());
  const [modelOverride, setModelOverride] = useState(() => readPiModelOverride());
  const desktopAvailable = isTauriRuntime();

  const providerConfigs = useMemo(() => status?.providerConfigs ?? [], [status]);
  const providerConfigById = useMemo(
    () => new Map(providerConfigs.map((config) => [config.provider, config])),
    [providerConfigs],
  );
  const providerTemplates = useMemo(
    () =>
      [...(status?.providerTemplates ?? [])].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    [status],
  );
  const providerTemplateById = useMemo(
    () => new Map(providerTemplates.map((template) => [template.provider, template])),
    [providerTemplates],
  );
  const configuredProviderIds = useMemo(
    () =>
      new Set([
        ...(status?.configuredProviderStatus ?? []).map((account) => account.provider),
        ...providerConfigs.map((config) => config.provider),
      ]),
    [providerConfigs, status],
  );
  const providerAccounts = useMemo(() => {
    const accounts = status?.configuredProviderStatus?.length
      ? status.configuredProviderStatus
      : (status?.providerStatus ?? []).filter(
          (account) => account.auth.configured || configuredProviderIds.has(account.provider),
        );
    return [...accounts].sort(providerSort);
  }, [configuredProviderIds, status]);
  const selectedProviderId = selection.mode === 'edit' ? selection.provider : null;
  const isAddProvider = selection.mode === 'add';
  const ready = providerAccounts.length > 0 && (status?.availableModels.length ?? 0) > 0;
  const selectedAccount = selectedProviderId
    ? (providerAccounts.find((account) => account.provider === selectedProviderId) ?? null)
    : null;
  const selectedConfig = selectedAccount
    ? (providerConfigById.get(selectedAccount.provider) ?? null)
    : null;
  const selectedModels = useMemo(
    () =>
      selectedAccount
        ? (status?.availableModels ?? []).filter(
            (model) => model.provider === selectedAccount.provider,
          )
        : [],
    [selectedAccount, status],
  );
  const shownModels = useMemo(() => status?.availableModels.slice(0, 16) ?? [], [status]);
  const addableTemplates = useMemo(
    () =>
      providerTemplates.filter(
        (template) =>
          !configuredProviderIds.has(template.provider) &&
          templateMatches(template, templateSearch),
      ),
    [configuredProviderIds, providerTemplates, templateSearch],
  );
  const modelsConfig = status?.modelsConfig;
  const paths = status?.paths;
  const isOverview = selection.mode === 'none';
  // Summary-first landing rows: name, status, model count, auth source per
  // configured provider. Model count prefers the runtime registry (available
  // models) and falls back to the saved config's model list when the provider
  // is configured but not yet authenticated.
  const providerOverview = useMemo(
    () =>
      providerAccounts.map((account) => {
        const config = providerConfigById.get(account.provider);
        const availableCount = (status?.availableModels ?? []).filter(
          (model) => model.provider === account.provider,
        ).length;
        const modelCount = availableCount || config?.models?.length || 0;
        return {
          account,
          modelCount,
          authSource: authSourceLabel(config?.authSource ?? account.auth.source),
        };
      }),
    [providerAccounts, providerConfigById, status],
  );
  const firstModelRow = form.models[0] ?? EMPTY_MODEL_FIELDS;
  const formModelCount = form.models.filter((model) => model.id.trim()).length;

  const refresh = useCallback(async () => {
    if (!desktopAvailable) {
      setError('Pi Agent status requires the release desktop runtime.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const next = await loadPiAgentStatus();
      setStatus(next);
    } catch (err) {
      const message = safeErrorMessage(err);
      setError(message);
      toast.error('Pi Agent status failed', { description: message });
    } finally {
      setIsLoading(false);
    }
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable) return;
    void refresh();
  }, [desktopAvailable, refresh]);

  useEffect(() => {
    if (!status) return;
    if (!providerAccounts.length) {
      // Nothing to summarize yet — land straight on the guided add form.
      if (selection.mode !== 'add') {
        loadedProviderRef.current = null;
        setSelection({ mode: 'add' });
      }
      return;
    }
    // Providers exist: the landing state is the summary overview ('none'). We do
    // NOT auto-hydrate provider[0] into the full edit form — the edit form only
    // opens on an explicit provider click. The one correction we make is pulling
    // a stale edit selection (provider deleted/renamed) back to the overview.
    if (
      selection.mode === 'edit' &&
      !providerAccounts.some((account) => account.provider === selection.provider)
    ) {
      loadedProviderRef.current = null;
      setSelection({ mode: 'none' });
    }
  }, [providerAccounts, selection, status]);

  useEffect(() => {
    if (selection.mode !== 'edit' || !selectedAccount) return;
    if (loadedProviderRef.current === selectedAccount.provider) return;
    loadedProviderRef.current = selectedAccount.provider;
    const config = providerConfigById.get(selectedAccount.provider);
    const template = providerTemplateById.get(selectedAccount.provider);
    setForm({
      providerId: selectedAccount.provider,
      displayName: config?.name ?? selectedAccount.displayName,
      baseUrl: config?.baseUrl ?? template?.baseUrl ?? '',
      api: config?.api ?? template?.api ?? 'openai-completions',
      apiKey: '',
      keepExistingApiKey: true,
      models: config?.models?.length
        ? modelRowsFromModels(config.models)
        : template?.models?.length
          ? modelRowsFromModels(template.models)
          : modelRowsFromModels(selectedModels),
    });
  }, [providerConfigById, providerTemplateById, selectedAccount, selectedModels, selection.mode]);

  function saveModelOverride(next: string) {
    setModelOverride(next);
    writePiModelOverride(next);
  }

  function updateForm<K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // The minimal add path edits a single initial model (row 0) directly; the full
  // multi-row list stays behind the "Manage models" disclosure.
  function updateFirstModel(patch: Partial<Omit<ProviderModelFormRow, 'rowKey'>>) {
    setForm((current) => {
      const rows = current.models.length ? current.models : [emptyModelRow()];
      const [first, ...rest] = rows;
      const head = first ?? emptyModelRow();
      return { ...current, models: [{ ...head, ...patch }, ...rest] };
    });
  }

  function backToOverview() {
    loadedProviderRef.current = null;
    setSelection({ mode: 'none' });
  }

  function showAddProvider() {
    loadedProviderRef.current = null;
    setSelection({ mode: 'add' });
    setForm(initialProviderForm());
    setTemplateSearch('');
  }

  function applyTemplate(template: PiAgentProviderTemplate) {
    loadedProviderRef.current = null;
    setSelection({ mode: 'add' });
    setForm({
      providerId: template.provider,
      displayName: template.displayName,
      baseUrl: template.baseUrl ?? '',
      api: template.api ?? 'openai-completions',
      apiKey: '',
      keepExistingApiKey: false,
      models: modelRowsFromModels(template.models),
    });
  }

  function selectProvider(provider: string) {
    loadedProviderRef.current = null;
    setSelection({ mode: 'edit', provider });
  }

  async function handleOpenConfigFolder() {
    try {
      await openPiConfigFolder();
    } catch (err) {
      toast.error('Open Pi config folder failed', { description: safeErrorMessage(err) });
    }
  }

  async function handleSaveProvider() {
    const models = serializeModelRows(form.models);
    if (models.length === 0) {
      toast.error('Add at least one model id');
      return;
    }
    if (!form.apiKey.trim() && !form.keepExistingApiKey) {
      toast.error('API key is required for a new provider');
      return;
    }
    setSavingProvider(true);
    try {
      const next = await savePiProvider(form, models);
      setStatus(next);
      loadedProviderRef.current = null;
      setSelection({ mode: 'edit', provider: form.providerId.trim() });
      setForm((current) => ({ ...current, apiKey: '', keepExistingApiKey: true }));
      toast.success('Provider saved to Pi models.json');
    } catch (err) {
      toast.error('Provider save failed', { description: safeErrorMessage(err) });
    } finally {
      setSavingProvider(false);
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Providers</div>
        <div className="off-set-panedesc">
          Configure Pi Agent model providers. Offisim shows status and writes Pi config only.
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
            Pi Agent Runtime
            <StatusPill tone={ready ? 'ok' : 'muted'}>{ready ? 'Ready' : 'Needs auth'}</StatusPill>
          </div>
          <div className="off-set-pv-meta">
            {providerAccounts.length} configured providers · {status?.availableModels.length ?? 0}{' '}
            available models · checked {checkedAtLabel(status?.checkedAt)}
          </div>
        </div>
        <Button
          variant="outline"
          size="md"
          disabled={isLoading || !desktopAvailable}
          onClick={() => void refresh()}
        >
          <Icon icon={RefreshCw} size="sm" />
          {isLoading ? 'Refreshing' : 'Refresh'}
        </Button>
      </div>

      {error ? (
        <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
          <Icon icon={TriangleAlert} size="sm" />
          {error}
        </div>
      ) : null}
      {!desktopAvailable ? (
        <div className="off-set-callout is-muted mt-[var(--off-sp-3)]">
          <Icon icon={Info} size="sm" />
          Pi Agent settings are available inside the desktop app.
        </div>
      ) : null}

      <section className="off-set-provider-console">
        <aside className="off-set-provider-list" aria-label="Configured providers">
          <div className="off-set-provider-list-head">
            <CapsLabel>Configured</CapsLabel>
            <span>{providerAccounts.length}</span>
          </div>
          {providerAccounts.length ? (
            <button
              type="button"
              className={`off-set-provider-nav off-focusable ${isOverview ? 'is-active' : ''}`}
              onClick={backToOverview}
            >
              <Icon icon={List} size="sm" />
              <span>All providers</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`off-set-provider-nav off-focusable ${isAddProvider ? 'is-active' : ''}`}
            onClick={showAddProvider}
          >
            <Icon icon={Plus} size="sm" />
            <span>Add provider</span>
          </button>
          <div className="off-set-provider-nav-scroll">
            {providerAccounts.length ? (
              providerAccounts.map((account) => (
                <button
                  type="button"
                  key={account.provider}
                  className={`off-set-provider-nav off-focusable ${
                    selectedProviderId === account.provider ? 'is-active' : ''
                  }`}
                  onClick={() => selectProvider(account.provider)}
                >
                  <span
                    className={`off-set-provider-dot ${
                      account.auth.configured ? 'is-ready' : 'is-muted'
                    }`}
                  />
                  <span className="off-set-provider-nav-copy">
                    <span>{account.displayName}</span>
                    <small>{account.provider}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className="off-set-provider-empty">
                No configured providers yet. Add one from a Pi template or enter a custom endpoint.
              </div>
            )}
          </div>
        </aside>

        <div className="off-set-provider-detail">
          {isAddProvider ? (
            <div className="off-set-provider-form">
              <div className="off-set-provider-detail-head">
                <div className="min-w-0">
                  {providerAccounts.length ? (
                    <button
                      type="button"
                      className="off-set-provider-back off-focusable"
                      onClick={backToOverview}
                    >
                      <Icon icon={ArrowLeft} size="sm" />
                      All providers
                    </button>
                  ) : null}
                  <h3>Add model provider</h3>
                  <p>Enter the essentials, or start from a Pi registry template below.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!desktopAvailable}
                  onClick={() => void handleOpenConfigFolder()}
                >
                  <Icon icon={FolderOpen} size="sm" />
                  Open config
                </Button>
              </div>
              <div className="off-set-provider-form-grid">
                <FormField label="Provider id" htmlFor={providerIdInputId}>
                  <Input
                    id={providerIdInputId}
                    value={form.providerId}
                    placeholder="zai"
                    spellCheck={false}
                    onChange={(event) => updateForm('providerId', event.currentTarget.value)}
                  />
                </FormField>
                <FormField label="API format" htmlFor={apiSelectId}>
                  <Input
                    id={apiSelectId}
                    value={form.api}
                    placeholder="openai-completions"
                    spellCheck={false}
                    onChange={(event) => updateForm('api', event.currentTarget.value)}
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
                <FormField label="API key" htmlFor={apiKeyInputId} wide>
                  <Input
                    id={apiKeyInputId}
                    type="password"
                    value={form.apiKey}
                    placeholder="Paste provider API key"
                    spellCheck={false}
                    onChange={(event) => updateForm('apiKey', event.currentTarget.value)}
                  />
                </FormField>
                <FormField label="Initial model id" htmlFor={initialModelInputId} wide>
                  <Input
                    id={initialModelInputId}
                    value={firstModelRow.id}
                    placeholder="glm-5.2"
                    spellCheck={false}
                    onChange={(event) => updateFirstModel({ id: event.currentTarget.value })}
                  />
                </FormField>
              </div>

              <details className="off-set-disclosure">
                <summary>
                  <span className="off-set-chev">
                    <Icon icon={ChevronRight} size="sm" />
                  </span>
                  Advanced
                </summary>
                <div className="off-set-disclosure-body">
                  <div className="off-set-provider-form-grid">
                    <FormField label="Display name" htmlFor={providerNameInputId} wide>
                      <Input
                        id={providerNameInputId}
                        value={form.displayName}
                        placeholder="Z.ai"
                        onChange={(event) => updateForm('displayName', event.currentTarget.value)}
                      />
                    </FormField>
                    <FormField label="Context window" htmlFor={contextWindowInputId}>
                      <Input
                        id={contextWindowInputId}
                        value={firstModelRow.contextWindow}
                        inputMode="numeric"
                        placeholder="128000"
                        spellCheck={false}
                        onChange={(event) =>
                          updateFirstModel({ contextWindow: event.currentTarget.value })
                        }
                      />
                    </FormField>
                    <FormField label="Max tokens" htmlFor={maxTokensInputId}>
                      <Input
                        id={maxTokensInputId}
                        value={firstModelRow.maxTokens}
                        inputMode="numeric"
                        placeholder="8192"
                        spellCheck={false}
                        onChange={(event) =>
                          updateFirstModel({ maxTokens: event.currentTarget.value })
                        }
                      />
                    </FormField>
                    <FormField label="Model API override" htmlFor={modelApiInputId} wide>
                      <Input
                        id={modelApiInputId}
                        value={firstModelRow.api}
                        placeholder="Inherit provider API format"
                        spellCheck={false}
                        onChange={(event) => updateFirstModel({ api: event.currentTarget.value })}
                      />
                    </FormField>
                  </div>
                </div>
              </details>

              {/* F3: PiAgentModelSummary from pi_agent_status carries no per-model
                  source or checked/stale timestamp — only a single top-level
                  checkedAt for the whole registry read (already shown in the
                  runtime header). Exact model ids are shown, but no per-model
                  "source · checked" indicator is added, since fabricating one
                  would misrepresent data the Pi registry payload does not expose. */}
              <details className="off-set-disclosure">
                <summary>
                  <span className="off-set-chev">
                    <Icon icon={ChevronRight} size="sm" />
                  </span>
                  Manage models
                  <span className="off-set-provider-disc-count">{formModelCount}</span>
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
                  disabled={savingProvider || !desktopAvailable}
                  onClick={() => void handleSaveProvider()}
                >
                  {savingProvider ? 'Saving...' : 'Save provider'}
                </Button>
              </div>
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
                        onClick={() => applyTemplate(template)}
                      >
                        <span>
                          <strong>{template.displayName}</strong>
                          <small>{template.provider}</small>
                        </span>
                        <em>{template.models?.[0]?.id ?? template.api ?? 'custom model'}</em>
                      </button>
                    ))
                  ) : (
                    <div className="off-set-provider-empty">
                      No matching templates. You can still type a custom provider above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : selectedAccount ? (
            <div className="off-set-provider-form">
              <div className="off-set-provider-detail-head">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="off-set-provider-back off-focusable"
                    onClick={backToOverview}
                  >
                    <Icon icon={ArrowLeft} size="sm" />
                    All providers
                  </button>
                  <h3>{selectedAccount.displayName}</h3>
                  <p>{selectedAccount.provider}</p>
                </div>
                <StatusPill tone={selectedAccount.auth.configured ? 'ok' : 'muted'}>
                  {selectedAccount.auth.configured ? 'Enabled' : 'Needs auth'}
                </StatusPill>
              </div>

              <div className="off-set-provider-summary-grid">
                <div>
                  <span>Connection mode</span>
                  <strong>{form.api}</strong>
                </div>
                <div>
                  <span>Auth source</span>
                  <strong>
                    {authSourceLabel(selectedConfig?.authSource ?? selectedAccount.auth.source)}
                  </strong>
                </div>
                <div>
                  <span>Available models</span>
                  <strong>{selectedModels.length}</strong>
                </div>
              </div>

              <div className="off-set-provider-form-grid">
                <FormField label="Base URL" htmlFor={baseUrlInputId} wide>
                  <Input
                    id={baseUrlInputId}
                    value={form.baseUrl}
                    placeholder="https://api.example.com/v1"
                    spellCheck={false}
                    onChange={(event) => updateForm('baseUrl', event.currentTarget.value)}
                  />
                </FormField>
                <FormField label="Display name" htmlFor={providerNameInputId}>
                  <Input
                    id={providerNameInputId}
                    value={form.displayName}
                    onChange={(event) => updateForm('displayName', event.currentTarget.value)}
                  />
                </FormField>
                <FormField label="API format" htmlFor={apiSelectId}>
                  <Input
                    id={apiSelectId}
                    value={form.api}
                    placeholder="openai-completions"
                    spellCheck={false}
                    onChange={(event) => updateForm('api', event.currentTarget.value)}
                  />
                </FormField>
                <FormField label="Replace API key" htmlFor={apiKeyInputId} wide>
                  <Input
                    id={apiKeyInputId}
                    type="password"
                    value={form.apiKey}
                    placeholder={
                      selectedConfig?.hasApiKey || selectedAccount.auth.configured
                        ? 'Leave blank to keep current key'
                        : 'Paste provider API key'
                    }
                    spellCheck={false}
                    onChange={(event) => updateForm('apiKey', event.currentTarget.value)}
                  />
                </FormField>
              </div>

              {/* F3: no per-model source/checked timestamp exists on the Pi
                  registry payload (see PiAgentModelSummary) — exact model ids are
                  editable here without a fabricated per-model indicator. */}
              <details className="off-set-disclosure">
                <summary>
                  <span className="off-set-chev">
                    <Icon icon={ChevronRight} size="sm" />
                  </span>
                  Manage models
                  <span className="off-set-provider-disc-count">{formModelCount}</span>
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
                  disabled={savingProvider || !desktopAvailable}
                  onClick={() => void handleSaveProvider()}
                >
                  {savingProvider ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  variant="subtle"
                  disabled={!desktopAvailable}
                  onClick={() => void copyText(selectedAccount.provider, 'Provider id')}
                >
                  <Icon icon={Copy} size="sm" />
                  Copy id
                </Button>
              </div>
            </div>
          ) : providerOverview.length ? (
            <div className="off-set-provider-form">
              <div className="off-set-provider-detail-head">
                <div className="min-w-0">
                  <h3>Configured providers</h3>
                  <p>Select a provider to edit its endpoint and models, or add a new one.</p>
                </div>
                <Button variant="outline" size="sm" onClick={showAddProvider}>
                  <Icon icon={Plus} size="sm" />
                  Add provider
                </Button>
              </div>
              <div className="off-set-provider-overview">
                {providerOverview.map(({ account, modelCount, authSource }) => (
                  <div className="off-set-provider-overview-row" key={account.provider}>
                    <span
                      className={`off-set-provider-dot ${
                        account.auth.configured ? 'is-ready' : 'is-muted'
                      }`}
                    />
                    <span className="off-set-provider-overview-copy">
                      <strong>{account.displayName}</strong>
                      <small>{account.provider}</small>
                    </span>
                    <span className="off-set-provider-overview-meta">
                      {modelCount} {modelCount === 1 ? 'model' : 'models'} · {authSource}
                    </span>
                    <StatusPill tone={account.auth.configured ? 'ok' : 'muted'}>
                      {account.auth.configured ? 'Enabled' : 'Needs auth'}
                    </StatusPill>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => selectProvider(account.provider)}
                    >
                      <Icon icon={Pencil} size="sm" />
                      Edit
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="off-set-callout is-muted">
              <Icon icon={Info} size="sm" />
              No providers configured yet. Add one to get started.
            </div>
          )}
        </div>
      </section>

      <section className="off-set-provider-config">
        <div className="off-set-provider-config-card">
          <div className="off-set-cs-label">
            <Icon icon={ShieldCheck} size="sm" />
            Stored credentials & model catalog
          </div>
          <div className="off-set-cs-sum">
            auth.json · {status?.authProviders.length ?? 0} stored providers
          </div>
          <div className="off-set-cs-sum">
            models.json · {copyLabel(modelsConfig?.path ?? paths?.modelsPath)}
          </div>
        </div>
        <div className="off-set-provider-config-card">
          <div className="off-set-cs-label">
            <Icon icon={SlidersHorizontal} size="sm" />
            Model configuration
          </div>
          <div className="off-set-cs-sum">
            {modelsConfig?.exists ? 'present' : 'not created'} · {modelsConfig?.providerCount ?? 0}{' '}
            loaded providers · {modelsConfig?.modelCount ?? status?.allModelCount ?? 0} registry
            models
          </div>
          {modelsConfig?.parseError ? (
            <div className="off-set-callout is-warn mt-[var(--off-sp-3)]">
              <Icon icon={TriangleAlert} size="sm" />
              {modelsConfig.parseError}
            </div>
          ) : null}
        </div>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Advanced model override</CapsLabel>
        </div>
        <div className="off-set-provider-override">
          <div className="off-set-field">
            <label htmlFor={modelOverrideInputId}>Runtime model</label>
            <Input
              id={modelOverrideInputId}
              value={modelOverride}
              placeholder="Pi default"
              spellCheck={false}
              onChange={(event) => saveModelOverride(event.currentTarget.value)}
            />
          </div>
          {shownModels.length ? (
            <div className="off-set-provider-suggested-models">
              {shownModels.map((model) => {
                const label = modelLabel(model);
                return (
                  <button
                    key={label}
                    type="button"
                    className="off-set-provider-mini-model off-focusable"
                    onClick={() => saveModelOverride(label)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {modelOverride ? (
            <div className="off-set-pi-actions mt-[var(--off-sp-3)]">
              <Button variant="subtle" size="sm" onClick={() => saveModelOverride('')}>
                Clear override
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
