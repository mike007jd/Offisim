import { useUiState } from '@/app/ui-state.js';
import { aiAccountLaneKey, aiModelSourceLabel } from '@/data/ai-model-presentation.js';
import { engineKindFromId, engineShortLabel } from '@/design-system/grammar/EngineMark.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import {
  type ConversationTargetKey,
  canSeedConversationRunDefaults,
  useConversationTargetDefaultsStore,
} from '@/runtime/conversation-target-defaults-store.js';
import { serializeRuntimeExecutionSelector } from '@/runtime/execution-selection.js';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
  usePiThreadModeStore,
} from '@/runtime/pi-thread-mode-store.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import { usePiThreadSpeedStore } from '@/runtime/pi-thread-speed-store.js';
import {
  DEFAULT_THINKING_LEVEL,
  type ThinkingLevel,
  usePiThreadThinkingStore,
} from '@/runtime/pi-thread-thinking-store.js';
import { thinkingLevelMeta } from '@/runtime/thinking-level-presentation.js';
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Gauge,
  type LucideIcon,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveComposerDefaultOption } from './composer-default-selection.js';
import { matchesComposerModelSearch, orderComposerModelGroups } from './composer-model-filter.js';
import {
  type AgentRuntimeModelOption,
  type OrchestrationEngineDirectoryEntry,
  useAgentRuntimeModels,
  useOrchestrationEngineDirectory,
  useThreadExecutionAuthority,
} from './usePiAgentModels.js';

const MODE_META: Record<PermissionMode, { label: string; icon: LucideIcon; meta: string }> = {
  plan: { label: 'Plan', icon: Eye, meta: 'Read-only — investigate, no changes' },
  ask: {
    label: 'Ask',
    icon: MessageCircleQuestion,
    meta: 'Read-only — approve changes and internet access',
  },
  auto: { label: 'Auto', icon: ShieldCheck, meta: 'Runs in the Project — asks when needed' },
  full: { label: 'Full', icon: Zap, meta: 'No restrictions' },
};

const ENGINE_STATE_LABEL: Record<OrchestrationEngineDirectoryEntry['state'], string> = {
  ready: 'Ready',
  'not-installed': 'Not installed',
  'not-signed-in': 'Not signed in',
  unavailable: 'Unavailable',
};

function pendingEngineMeta(engine: OrchestrationEngineDirectoryEntry): string {
  if (engine.state === 'not-signed-in' && engine.loginCommand) {
    return `Run \`${engine.loginCommand}\` to sign in`;
  }
  return engine.statusReason?.trim() || 'Finish setup in Settings to select this engine';
}

function catalogDateLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function modelOptionMeta(option: AgentRuntimeModelOption): string {
  if (option.selectionKind === 'orchestration-engine') {
    if (option.modelId === 'engine-managed') {
      return 'External CLI · model managed by the engine';
    }
    const parts: string[] = [option.modelId];
    if (option.note) parts.push(option.note);
    return parts.join(' · ');
  }
  // The row's primary line is the model name; when name === modelId the meta
  // line must not repeat it — only genuinely additional facts appear below.
  const parts: string[] = option.name === option.modelId ? [] : [option.modelId];
  if (option.source) parts.push(aiModelSourceLabel(option.source));
  if (option.expiresAt) parts.push(`Expires ${catalogDateLabel(option.expiresAt)}`);
  else if (option.availabilityReason?.trim()) parts.push(option.availabilityReason.trim());
  else if (option.availability === 'expiring') parts.push('Expiration date not reported');
  return parts.join(' · ');
}

/** Model leaf id — the segment after the last `/` (e.g. `north-mini-code:free`). */
function modelLeafId(option: AgentRuntimeModelOption): string {
  return option.modelId.split('/').at(-1) || option.modelId;
}

type PickerLayer = 'root' | 'model' | 'reasoning' | 'speed' | 'mode';

const SPEED_META: Record<'standard' | 'fast', { label: string; meta: string }> = {
  standard: { label: 'Standard', meta: 'Included speed — no extra cost' },
  fast: { label: 'Fast', meta: 'Higher speed at a higher cost' },
};

function useConversationRunDefaultSeeding(
  threadId: string,
  targetKey: ConversationTargetKey | undefined,
  defaultModelSelector: string | undefined,
): void {
  const targetDefaults = useConversationTargetDefaultsStore((state) =>
    targetKey ? state.byTarget[targetKey] : undefined,
  );
  const models = useAgentRuntimeModels();
  const threadAuthority = useThreadExecutionAuthority(threadId);
  const seededTargetsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!targetKey || !targetDefaults) return;
    const seedKey = `${threadId}\0${targetKey}`;
    if (seededTargetsRef.current.has(seedKey)) return;

    // A resumed thread can report no authority while its first query is still
    // pending. Only an explicitly fetched `null` is permission to seed a new
    // conversation; undefined/error states and durable authorities are closed.
    const options = models.data ?? [];
    if (
      !canSeedConversationRunDefaults({
        authorityIsFetched: threadAuthority.isFetched,
        authority: threadAuthority.data,
        hasCatalog: Boolean(options?.length),
      })
    ) {
      return;
    }

    seededTargetsRef.current.add(seedKey);
    const modelStore = usePiThreadModelStore.getState();
    const thinkingStore = usePiThreadThinkingStore.getState();
    const speedStore = usePiThreadSpeedStore.getState();
    const modeStore = usePiThreadModeStore.getState();
    const existingModel = modelStore.byThread[threadId];
    const targetModel = targetDefaults.model
      ? options.find((option) => option.value === targetDefaults.model)
      : undefined;

    if (!(threadId in modelStore.byThread) && targetModel) {
      modelStore.setThreadModel(threadId, targetModel.value);
    }

    const landingModel = existingModel
      ? options.find((option) => option.value === existingModel)
      : (targetModel ??
        resolveComposerDefaultOption(
          options,
          [defaultModelSelector].filter((selector): selector is string => Boolean(selector)),
        ));
    if (!landingModel) return;

    if (
      !(threadId in thinkingStore.byThread) &&
      targetDefaults.thinking &&
      landingModel.reasoningEfforts.includes(targetDefaults.thinking)
    ) {
      thinkingStore.setThreadThinking(threadId, targetDefaults.thinking);
    }
    if (
      !(threadId in speedStore.byThread) &&
      targetDefaults.speed === 'fast' &&
      landingModel.speedModes.includes('fast')
    ) {
      speedStore.setThreadSpeed(threadId, 'fast');
    }
    if (
      !(threadId in modeStore.byThread) &&
      targetDefaults.mode &&
      landingModel.capabilities.permissionModes.includes(targetDefaults.mode)
    ) {
      modeStore.setThreadMode(threadId, targetDefaults.mode);
    }
  }, [
    defaultModelSelector,
    models.data,
    targetDefaults,
    targetKey,
    threadAuthority.data,
    threadAuthority.isFetched,
    threadId,
  ]);
}

/**
 * Single composer chip consolidating the per-conversation run settings —
 * Model, Reasoning (thinking level), and Permission mode — behind one menu
 * with drill-in layers (no sideways submenus, so nothing flips direction near
 * screen edges). Radix owns focus trap, Escape, and trigger focus restoration;
 * layer switches keep the same menu surface and refocus the first row.
 */
export function ComposerSettingsMenu({
  threadId,
  contextLabel,
  defaultModelSelector,
  targetKey,
  showMode = true,
}: {
  threadId: string;
  /** Quiet menu heading (e.g. the project name); omitted when empty. */
  contextLabel?: string;
  /** Employee-bound runtime selector used only while the thread has no durable authority. */
  defaultModelSelector?: string;
  /** Office conversation target whose last manual run settings seed new threads. */
  targetKey?: ConversationTargetKey;
  /** Permission mode applies to Office runs; Connect uses its Chat/Read-only profile instead. */
  showMode?: boolean;
}) {
  const perThreadModel = usePiThreadModelStore((s) => s.byThread[threadId] ?? '');
  const setThreadModel = usePiThreadModelStore((s) => s.setThreadModel);
  const models = useAgentRuntimeModels();
  const engineDirectory = useOrchestrationEngineDirectory();
  const setSurface = useUiState((s) => s.setSurface);
  const mode = usePiThreadModeStore((s) => s.byThread[threadId] ?? DEFAULT_PERMISSION_MODE);
  const setThreadMode = usePiThreadModeStore((s) => s.setThreadMode);
  const thinkingOverride = usePiThreadThinkingStore((s) => s.byThread[threadId]);
  const setThreadThinking = usePiThreadThinkingStore((s) => s.setThreadThinking);
  const clearThreadThinking = usePiThreadThinkingStore((s) => s.clearThreadThinking);
  const speedOverride = usePiThreadSpeedStore((s) => s.byThread[threadId]);
  const setThreadSpeed = usePiThreadSpeedStore((s) => s.setThreadSpeed);
  const clearThreadSpeedOverride = usePiThreadSpeedStore((s) => s.clearThreadSpeed);
  const threadAuthority = useThreadExecutionAuthority(threadId);
  const catalogUnavailable = models.isError && !models.data?.length;
  const setTargetRunDefault = useConversationTargetDefaultsStore(
    (state) => state.setTargetRunDefault,
  );
  useConversationRunDefaultSeeding(threadId, targetKey, defaultModelSelector);

  const [layer, setLayer] = useState<PickerLayer>('root');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [expandedFreeLaneKeys, setExpandedFreeLaneKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);

  // Search is the model layer's keyboard entry point. Other drill-in layers
  // retain the menu's normal first-row focus behavior.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (layer === 'model') {
        modelSearchInputRef.current?.focus();
        return;
      }
      const first = contentRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])',
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [layer]);

  // Derive the effective model, account-grouped list, and reasoning support
  // once per change. The composer subtree re-renders on every keystroke and
  // run-state tick, so this keeps the grouping off the hot path.
  const {
    accounts,
    defaultModel,
    durableModel,
    effectiveModel,
    selectedModelUnavailable,
    selectedFromAnotherLane,
    reasoningLevels,
    supportedModes,
    level,
  } = useMemo(() => {
    const allModels = models.data ?? [];
    const authority = threadAuthority.data ?? null;
    const sameLane = (option: (typeof allModels)[number]) =>
      !authority ||
      (option.engineId === authority.target.engineId &&
        option.accountId === authority.target.accountId &&
        option.billingMode === authority.target.billingMode);
    const list = allModels.filter(sameLane);
    const rawSelected = allModels.find((option) => option.value === perThreadModel);
    const selected = list.find((option) => option.value === perThreadModel);
    const durableSelector = authority
      ? serializeRuntimeExecutionSelector(
          authority.target.engineId === 'api'
            ? { kind: 'api-model', runtimeModelRef: authority.runtimeModelRef }
            : {
                kind: 'orchestration-engine',
                engineId: authority.target.engineId,
                // Explicit-model freezes must round-trip: without the modelId
                // the serialized selector never matches an explicit-model row,
                // so the durable projection reads "Model unavailable".
                modelId: authority.target.modelId,
              },
        )
      : undefined;
    const durable = authority
      ? list.find(
          (option) =>
            option.value === durableSelector && option.modelId === authority.target.modelId,
        )
      : undefined;
    const stableDefault = authority
      ? durable
      : resolveComposerDefaultOption(
          list,
          [defaultModelSelector].filter((selector): selector is string => Boolean(selector)),
        );
    const effective = perThreadModel && !selected ? undefined : (selected ?? stableDefault);
    const groups = new Map<string, { account: string; items: typeof list }>();
    for (const option of list) {
      const laneKey = aiAccountLaneKey(option.engineId, option.accountId, option.billingMode);
      const existing = groups.get(laneKey);
      if (existing) existing.items.push(option);
      else groups.set(laneKey, { account: option.accountName, items: [option] });
    }
    const effectiveLaneKey = effective
      ? aiAccountLaneKey(effective.engineId, effective.accountId, effective.billingMode)
      : undefined;
    const exactLevels = effective?.reasoningEfforts ?? [];
    const nativeDefault = effective?.defaultReasoningEffort ?? exactLevels[0];
    const effectiveLevel =
      thinkingOverride && exactLevels.includes(thinkingOverride)
        ? thinkingOverride
        : (nativeDefault ?? DEFAULT_THINKING_LEVEL);
    return {
      accounts: orderComposerModelGroups(groups, effectiveLaneKey, Boolean(authority)),
      defaultModel: stableDefault,
      durableModel: durable,
      effectiveModel: effective,
      selectedModelUnavailable: Boolean(
        perThreadModel && !selected && !models.isLoading && !catalogUnavailable,
      ),
      selectedFromAnotherLane: Boolean(authority && rawSelected && !sameLane(rawSelected)),
      reasoningLevels: exactLevels,
      supportedModes: (effective?.capabilities.permissionModes ?? []).filter(
        (candidate): candidate is PermissionMode => PERMISSION_MODES.includes(candidate),
      ),
      level: effectiveLevel,
    };
  }, [
    perThreadModel,
    models.data,
    models.isLoading,
    threadAuthority.data,
    thinkingOverride,
    catalogUnavailable,
    defaultModelSelector,
  ]);

  useEffect(() => {
    if (selectedFromAnotherLane && durableModel) {
      setThreadModel(threadId, durableModel.value);
    }
  }, [durableModel, selectedFromAnotherLane, setThreadModel, threadId]);

  useEffect(() => {
    if (selectedModelUnavailable && !threadAuthority.data && models.data) {
      setThreadModel(threadId, '');
    }
  }, [models.data, selectedModelUnavailable, setThreadModel, threadAuthority.data, threadId]);

  useEffect(() => {
    if (thinkingOverride && !reasoningLevels.includes(thinkingOverride)) {
      clearThreadThinking(threadId);
    }
  }, [clearThreadThinking, reasoningLevels, thinkingOverride, threadId]);

  const supportsFast = Boolean(effectiveModel?.speedModes.includes('fast'));
  const speed: 'standard' | 'fast' = supportsFast && speedOverride === 'fast' ? 'fast' : 'standard';
  const speedIsCustom = Boolean(speedOverride && supportsFast);

  // Fast is model-bound (e.g. Opus-only): switching to a model without fast
  // support drops the override instead of silently carrying it along.
  useEffect(() => {
    if (effectiveModel && speedOverride === 'fast' && !supportsFast) {
      clearThreadSpeedOverride(threadId);
    }
  }, [clearThreadSpeedOverride, effectiveModel, speedOverride, supportsFast, threadId]);

  useEffect(() => {
    if (!supportedModes.length || supportedModes.includes(mode)) return;
    setThreadMode(threadId, supportedModes[0] ?? DEFAULT_PERMISSION_MODE);
  }, [mode, setThreadMode, supportedModes, threadId]);

  const supportsReasoning = reasoningLevels.length > 0;
  const defaultReasoningEffort = effectiveModel?.defaultReasoningEffort ?? reasoningLevels[0];
  const reasoningIsCustom = Boolean(thinkingOverride && reasoningLevels.includes(thinkingOverride));
  const lockedAuthority = threadAuthority.data ?? null;
  // Engines that exist but cannot run yet stay visible with setup guidance
  // instead of disappearing; a locked thread hides them (its lane is fixed).
  const pendingEngines = lockedAuthority
    ? []
    : engineDirectory.entries.filter((engine) => engine.state !== 'ready');
  const modelRadioValue = perThreadModel || durableModel?.value || '';
  const orchestrationSelected = effectiveModel?.selectionKind === 'orchestration-engine';
  const engineManagedSelected =
    orchestrationSelected && effectiveModel?.modelId === 'engine-managed';
  const defaultSourceLabel = engineManagedSelected ? 'Engine default' : 'Model default';
  const showPermissionMode = showMode && supportedModes.length > 0;
  const normalizedModelSearchQuery = modelSearchQuery.trim().toLowerCase();
  const filteredAccounts = useMemo(
    () =>
      accounts
        .map((group) => ({
          ...group,
          regularItems: group.regularItems.filter((option) =>
            matchesComposerModelSearch(option, normalizedModelSearchQuery),
          ),
          freeItems: group.freeItems.filter((option) =>
            matchesComposerModelSearch(option, normalizedModelSearchQuery),
          ),
        }))
        .filter((group) => group.regularItems.length || group.freeItems.length),
    [accounts, normalizedModelSearchQuery],
  );
  const hasFilteredModels = filteredAccounts.length > 0;

  const summary = [
    effectiveModel?.name ??
      (models.isLoading
        ? 'Loading model…'
        : catalogUnavailable
          ? 'Model catalog unavailable'
          : selectedModelUnavailable
            ? 'Selected model unavailable — reselect'
            : 'Model unavailable'),
    supportsReasoning ? thinkingLevelMeta(level).label : null,
    supportsFast && speed === 'fast' ? SPEED_META.fast.label : null,
    showPermissionMode ? MODE_META[mode].label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // API lane trigger: the exact model leaf id only. Orchestration lane: the
  // engine's short name for the engine-managed default, the exact model id
  // once one is chosen. Full details stay one hover away via `title`.
  const triggerLabel = effectiveModel
    ? orchestrationSelected
      ? effectiveModel.modelId === 'engine-managed'
        ? engineShortLabel(engineKindFromId(effectiveModel.engineId, effectiveModel.name))
        : modelLeafId(effectiveModel)
      : modelLeafId(effectiveModel)
    : models.isLoading
      ? 'Loading…'
      : catalogUnavailable
        ? 'No catalog'
        : selectedModelUnavailable
          ? 'Reselect'
          : 'No model';

  const drill = (next: PickerLayer) => (event: Event) => {
    event.preventDefault();
    setLayer(next);
  };

  const modelRowLabel = orchestrationSelected ? 'Engine' : 'Model';
  const modelRowValue =
    effectiveModel?.name ??
    (catalogUnavailable
      ? 'Catalog unavailable'
      : selectedModelUnavailable
        ? 'Reselect'
        : 'Unavailable');

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          setLayer('root');
          setModelSearchQuery('');
          setExpandedFreeLaneKeys(new Set());
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="off-composer-chip off-composer-settings-chip off-focusable"
          aria-label={`Conversation settings: ${summary}`}
          title={summary}
        >
          <span className="off-composer-chip-text">{triggerLabel}</span>
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="end"
        className={
          layer === 'model' ? 'off-composer-menu off-composer-model-menu' : 'off-composer-menu'
        }
        onEscapeKeyDown={(event) => {
          if (layer === 'model' && modelSearchQuery) {
            event.preventDefault();
            setModelSearchQuery('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && layer !== 'root') {
            event.preventDefault();
            event.stopPropagation();
            setLayer('root');
          }
        }}
      >
        {layer === 'root' ? (
          <>
            {contextLabel ? (
              <>
                <DropdownMenuLabel className="off-composer-menu-provider">
                  {contextLabel}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={drill('model')}>
              <Icon icon={Bot} size="sm" />
              <span className="off-composer-menu-row">
                <span className="off-composer-menu-name">{modelRowLabel}</span>
                <span className="off-composer-menu-meta">{modelRowValue}</span>
              </span>
              <span className="off-composer-menu-caret">
                <Icon icon={ChevronRight} size="sm" />
              </span>
            </DropdownMenuItem>
            {supportsReasoning ? (
              <DropdownMenuItem onSelect={drill('reasoning')}>
                <Icon icon={Brain} size="sm" />
                <span className="off-composer-menu-row">
                  <span className="off-composer-menu-name">Reasoning</span>
                  <span className="off-composer-menu-meta">
                    {thinkingLevelMeta(level).label} ·{' '}
                    {reasoningIsCustom ? 'Custom' : defaultSourceLabel}
                  </span>
                </span>
                <span className="off-composer-menu-caret">
                  <Icon icon={ChevronRight} size="sm" />
                </span>
              </DropdownMenuItem>
            ) : null}
            {supportsFast ? (
              <DropdownMenuItem onSelect={drill('speed')}>
                <Icon icon={Gauge} size="sm" />
                <span className="off-composer-menu-row">
                  <span className="off-composer-menu-name">Speed</span>
                  <span className="off-composer-menu-meta">
                    {SPEED_META[speed].label} · {speedIsCustom ? 'Custom' : defaultSourceLabel}
                  </span>
                </span>
                <span className="off-composer-menu-caret">
                  <Icon icon={ChevronRight} size="sm" />
                </span>
              </DropdownMenuItem>
            ) : null}
            {showPermissionMode ? (
              <DropdownMenuItem onSelect={drill('mode')}>
                <Icon icon={MODE_META[mode].icon} size="sm" />
                <span className="off-composer-menu-row">
                  <span className="off-composer-menu-name">Mode</span>
                  <span className="off-composer-menu-meta">{MODE_META[mode].label}</span>
                </span>
                <span className="off-composer-menu-caret">
                  <Icon icon={ChevronRight} size="sm" />
                </span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSurface('settings')}>
              <Icon icon={SlidersHorizontal} size="sm" />
              Manage AI engines…
            </DropdownMenuItem>
          </>
        ) : null}

        {layer === 'model' ? (
          <>
            <DropdownMenuItem onSelect={drill('root')} className="off-composer-menu-back">
              <Icon icon={ChevronLeft} size="sm" />
              <span className="off-composer-menu-name">
                {orchestrationSelected ? 'Engine' : 'Engine and model'}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="off-search-input-wrap off-composer-model-search-wrap">
              <Search className="off-search-input-icon" aria-hidden="true" />
              <input
                ref={modelSearchInputRef}
                type="search"
                value={modelSearchQuery}
                className="off-input off-search-input off-composer-model-search"
                placeholder="Search models"
                aria-label="Search models"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    if (modelSearchQuery) {
                      event.preventDefault();
                      event.stopPropagation();
                      setModelSearchQuery('');
                    }
                    return;
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    const options = contentRef.current?.querySelectorAll<HTMLElement>(
                      '[role="menuitemradio"]:not([aria-disabled="true"])',
                    );
                    const target =
                      event.key === 'ArrowDown'
                        ? options?.item(0)
                        : options?.item(options.length - 1);
                    target?.focus();
                    return;
                  }
                  event.stopPropagation();
                }}
              />
            </div>
            {lockedAuthority ? (
              <DropdownMenuLabel className="off-composer-menu-provider">
                Locked to {durableModel?.accountName ?? 'AI engine'} ·{' '}
                {lockedAuthority.target.engineId}
              </DropdownMenuLabel>
            ) : null}
            {catalogUnavailable ? (
              <>
                <DropdownMenuItem disabled>
                  <Icon icon={TriangleAlert} size="sm" />
                  Model catalog unavailable
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void models.refetch()}>
                  <Icon icon={RefreshCw} size="sm" />
                  Retry loading models
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuRadioGroup
                value={modelRadioValue}
                onValueChange={(value) => {
                  setThreadModel(threadId, value);
                  if (targetKey) {
                    setTargetRunDefault(
                      targetKey,
                      { axis: 'model', value: value || undefined },
                      Date.now(),
                    );
                  }
                  setLayer('root');
                }}
              >
                {selectedModelUnavailable && !normalizedModelSearchQuery ? (
                  <DropdownMenuRadioItem
                    value={perThreadModel}
                    disabled
                    onSelect={(event) => event.preventDefault()}
                  >
                    Selected model unavailable · choose another
                  </DropdownMenuRadioItem>
                ) : null}
                {!lockedAuthority && !normalizedModelSearchQuery ? (
                  <DropdownMenuRadioItem
                    value=""
                    disabled={!defaultModel}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {defaultModel
                      ? `Default · ${
                          defaultModel.selectionKind === 'orchestration-engine' &&
                          defaultModel.modelId === 'engine-managed'
                            ? `Engine default (${engineShortLabel(
                                engineKindFromId(defaultModel.engineId, defaultModel.name),
                              )})`
                            : defaultModel.name
                        }`
                      : 'Default model unavailable'}
                  </DropdownMenuRadioItem>
                ) : null}
                {hasFilteredModels ? (
                  filteredAccounts.map((group) => (
                    <div key={group.laneKey}>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="off-composer-menu-provider">
                        {group.account}
                      </DropdownMenuLabel>
                      {group.regularItems.map((option) => {
                        const optionMeta = modelOptionMeta(option);
                        return (
                          <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}
                            onSelect={(event) => event.preventDefault()}
                          >
                            <span className="off-composer-menu-row">
                              <span className="off-composer-menu-name">{option.name}</span>
                              {optionMeta && optionMeta !== option.name ? (
                                <span className="off-composer-menu-meta" title={optionMeta}>
                                  {optionMeta}
                                </span>
                              ) : null}
                            </span>
                          </DropdownMenuRadioItem>
                        );
                      })}
                      {group.freeItems.length ? (
                        <>
                          {!normalizedModelSearchQuery ? (
                            <DropdownMenuItem
                              className="off-composer-free-model-toggle"
                              onSelect={(event) => {
                                event.preventDefault();
                                setExpandedFreeLaneKeys((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.laneKey)) next.delete(group.laneKey);
                                  else next.add(group.laneKey);
                                  return next;
                                });
                              }}
                            >
                              <Icon
                                icon={
                                  expandedFreeLaneKeys.has(group.laneKey)
                                    ? ChevronDown
                                    : ChevronRight
                                }
                                size="sm"
                              />
                              {expandedFreeLaneKeys.has(group.laneKey)
                                ? `Hide ${group.freeItems.length} free models`
                                : `Show ${group.freeItems.length} free models`}
                            </DropdownMenuItem>
                          ) : null}
                          {normalizedModelSearchQuery || expandedFreeLaneKeys.has(group.laneKey)
                            ? group.freeItems.map((option) => {
                                const optionMeta = modelOptionMeta(option);
                                return (
                                  <DropdownMenuRadioItem
                                    key={option.value}
                                    value={option.value}
                                    onSelect={(event) => event.preventDefault()}
                                  >
                                    <span className="off-composer-menu-row">
                                      <span className="off-composer-menu-name">{option.name}</span>
                                      {optionMeta && optionMeta !== option.name ? (
                                        <span className="off-composer-menu-meta" title={optionMeta}>
                                          {optionMeta}
                                        </span>
                                      ) : null}
                                    </span>
                                  </DropdownMenuRadioItem>
                                );
                              })
                            : null}
                        </>
                      ) : null}
                    </div>
                  ))
                ) : normalizedModelSearchQuery ? (
                  <output className="off-composer-model-empty">
                    No models match “{modelSearchQuery.trim()}”
                  </output>
                ) : (
                  <DropdownMenuItem disabled>
                    {models.isLoading ? 'Loading models…' : 'No available models'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuRadioGroup>
            )}
            {pendingEngines.length && !normalizedModelSearchQuery ? (
              <>
                {pendingEngines.map((engine) => (
                  <div key={engine.engineId}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="off-composer-menu-provider">
                      {engine.displayName}
                    </DropdownMenuLabel>
                    <DropdownMenuItem disabled>
                      <span className="off-composer-menu-row">
                        <span className="off-composer-menu-name">
                          {ENGINE_STATE_LABEL[engine.state]}
                        </span>
                        <span className="off-composer-menu-meta" title={pendingEngineMeta(engine)}>
                          {pendingEngineMeta(engine)}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSurface('settings')}>
                  <Icon icon={SlidersHorizontal} size="sm" />
                  Set up engines in Settings…
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}

        {layer === 'reasoning' ? (
          <>
            <DropdownMenuItem onSelect={drill('root')} className="off-composer-menu-back">
              <Icon icon={ChevronLeft} size="sm" />
              <span className="off-composer-menu-name">Reasoning</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Thinking level</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={level}
              onValueChange={(value) => {
                const selectedLevel = value as ThinkingLevel;
                const resetsToDefault = selectedLevel === defaultReasoningEffort;
                if (resetsToDefault) clearThreadThinking(threadId);
                else setThreadThinking(threadId, selectedLevel);
                if (targetKey) {
                  setTargetRunDefault(
                    targetKey,
                    { axis: 'thinking', value: resetsToDefault ? undefined : selectedLevel },
                    Date.now(),
                  );
                }
                setLayer('root');
              }}
            >
              {reasoningLevels.map((value) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="off-composer-menu-row">
                    <span className="off-composer-menu-name">{thinkingLevelMeta(value).label}</span>
                    <span className="off-composer-menu-meta">
                      {thinkingLevelMeta(value).meta}
                      {value === defaultReasoningEffort ? ` · ${defaultSourceLabel}` : ''}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {reasoningIsCustom ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    clearThreadThinking(threadId);
                    if (targetKey) {
                      setTargetRunDefault(
                        targetKey,
                        { axis: 'thinking', value: undefined },
                        Date.now(),
                      );
                    }
                    setLayer('root');
                  }}
                >
                  <Icon icon={RefreshCw} size="sm" />
                  Reset to {defaultSourceLabel.toLowerCase()}
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}

        {layer === 'speed' ? (
          <>
            <DropdownMenuItem onSelect={drill('root')} className="off-composer-menu-back">
              <Icon icon={ChevronLeft} size="sm" />
              <span className="off-composer-menu-name">Speed</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Response speed</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={speed}
              onValueChange={(value) => {
                if (value === 'fast') setThreadSpeed(threadId, 'fast');
                else clearThreadSpeedOverride(threadId);
                if (targetKey) {
                  setTargetRunDefault(
                    targetKey,
                    { axis: 'speed', value: value === 'fast' ? 'fast' : undefined },
                    Date.now(),
                  );
                }
                setLayer('root');
              }}
            >
              {(['standard', 'fast'] as const).map((value) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="off-composer-menu-row">
                    <span className="off-composer-menu-name">{SPEED_META[value].label}</span>
                    <span className="off-composer-menu-meta">
                      {value === 'fast'
                        ? (effectiveModel?.fastModeNote ?? SPEED_META.fast.meta)
                        : `${SPEED_META.standard.meta}${
                            speedIsCustom ? ` · Reset to ${defaultSourceLabel.toLowerCase()}` : ''
                          }`}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}

        {layer === 'mode' ? (
          <>
            <DropdownMenuItem onSelect={drill('root')} className="off-composer-menu-back">
              <Icon icon={ChevronLeft} size="sm" />
              <span className="off-composer-menu-name">Mode</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Permission mode</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => {
                setThreadMode(threadId, value as PermissionMode);
                if (targetKey) {
                  setTargetRunDefault(
                    targetKey,
                    { axis: 'mode', value: value as PermissionMode },
                    Date.now(),
                  );
                }
                setLayer('root');
              }}
            >
              {supportedModes.map((value) => (
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="off-composer-menu-row">
                    <span className="off-composer-menu-name">{MODE_META[value].label}</span>
                    <span className="off-composer-menu-meta">{MODE_META[value].meta}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
