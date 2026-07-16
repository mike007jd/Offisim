import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
  usePiThreadModeStore,
} from '@/runtime/pi-thread-mode-store.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import {
  DEFAULT_THINKING_LEVEL,
  type ThinkingLevel,
  usePiThreadThinkingStore,
} from '@/runtime/pi-thread-thinking-store.js';
import {
  Bot,
  Brain,
  ChevronDown,
  Eye,
  type LucideIcon,
  MessageCircleQuestion,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import {
  type AgentRuntimeModelOption,
  useAgentRuntimeModels,
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

/**
 * Thinking-level labels + qualitative depth hints. Deliberately no token
 * numbers: the provider decides the real budget per level, so a "~Nk tokens"
 * figure would be false precision.
 */
const KNOWN_THINKING_META: Record<string, { label: string; meta: string }> = {
  off: { label: 'Off', meta: 'No reasoning' },
  none: { label: 'Off', meta: 'No reasoning' },
  minimal: { label: 'Minimal', meta: 'Very brief' },
  low: { label: 'Low', meta: 'Light' },
  medium: { label: 'Medium', meta: 'Moderate' },
  high: { label: 'High', meta: 'Deep' },
  xhigh: { label: 'Extra high', meta: 'Very deep' },
  max: { label: 'Max', meta: 'Maximum' },
  ultra: { label: 'Ultra', meta: 'Proactive multi-agent' },
};

function thinkingMeta(level: ThinkingLevel): { label: string; meta: string } {
  const known = KNOWN_THINKING_META[level];
  if (known) return known;
  const label = level
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
  return { label: label || level, meta: 'Model-defined effort' };
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
    return 'External CLI · model managed by the engine';
  }
  const parts = [option.modelId];
  if (option.availabilityReason?.trim()) parts.push(option.availabilityReason.trim());
  if (option.expiresAt) parts.push(`Expires ${catalogDateLabel(option.expiresAt)}`);
  else if (option.availability === 'expiring') parts.push('Expiration date not reported');
  return parts.join(' · ');
}

/**
 * Single composer chip consolidating the per-conversation run settings —
 * Model, Reasoning (thinking level), and Permission mode — behind one
 * dropdown with submenus, so the composer footer stays narrow and Send is
 * never pushed out of view. The chip summary always reflects the effective
 * choices. Zero assistant-ui dependency: everything is threadId-keyed store
 * state, so the same control drops into any composer (Office, Connect).
 */
export function ComposerSettingsMenu({
  threadId,
  contextLabel,
  showMode = true,
}: {
  threadId: string;
  /** Quiet menu heading (e.g. the project name); omitted when empty. */
  contextLabel?: string;
  /** Permission mode applies to Office runs; Connect uses its Chat/Read-only profile instead. */
  showMode?: boolean;
}) {
  const perThreadModel = usePiThreadModelStore((s) => s.byThread[threadId] ?? '');
  const setThreadModel = usePiThreadModelStore((s) => s.setThreadModel);
  const models = useAgentRuntimeModels();
  const setSurface = useUiState((s) => s.setSurface);
  const mode = usePiThreadModeStore((s) => s.byThread[threadId] ?? DEFAULT_PERMISSION_MODE);
  const setThreadMode = usePiThreadModeStore((s) => s.setThreadMode);
  const thinkingOverride = usePiThreadThinkingStore((s) => s.byThread[threadId]);
  const setThreadThinking = usePiThreadThinkingStore((s) => s.setThreadThinking);
  const clearThreadThinking = usePiThreadThinkingStore((s) => s.clearThreadThinking);
  const threadAuthority = useThreadExecutionAuthority(threadId);
  const catalogUnavailable = models.isError && !models.data?.length;

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
    const durable = authority
      ? list.find(
          (option) =>
            option.value === authority.runtimeModelRef &&
            option.modelId === authority.target.modelId,
        )
      : undefined;
    const stableDefault = authority
      ? durable
      : list.find((option) => option.availability === 'available');
    const effective = selected ?? stableDefault;
    const groups = new Map<string, { account: string; items: typeof list }>();
    for (const option of list) {
      const existing = groups.get(option.accountId);
      if (existing) existing.items.push(option);
      else groups.set(option.accountId, { account: option.accountName, items: [option] });
    }
    const exactLevels = effective?.reasoningEfforts ?? [];
    const nativeDefault = effective?.defaultReasoningEffort ?? exactLevels[0];
    const effectiveLevel =
      thinkingOverride && exactLevels.includes(thinkingOverride)
        ? thinkingOverride
        : (nativeDefault ?? DEFAULT_THINKING_LEVEL);
    return {
      accounts: [...groups].map(([accountId, group]) => ({ accountId, ...group })),
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
  ]);

  useEffect(() => {
    if (selectedFromAnotherLane && durableModel) {
      setThreadModel(threadId, durableModel.value);
    }
  }, [durableModel, selectedFromAnotherLane, setThreadModel, threadId]);

  useEffect(() => {
    if (thinkingOverride && !reasoningLevels.includes(thinkingOverride)) {
      clearThreadThinking(threadId);
    }
  }, [clearThreadThinking, reasoningLevels, thinkingOverride, threadId]);

  useEffect(() => {
    if (!supportedModes.length || supportedModes.includes(mode)) return;
    setThreadMode(threadId, supportedModes[0] ?? DEFAULT_PERMISSION_MODE);
  }, [mode, setThreadMode, supportedModes, threadId]);

  const supportsReasoning = reasoningLevels.length > 0;
  const lockedAuthority = threadAuthority.data ?? null;
  const modelRadioValue = perThreadModel || durableModel?.value || '';
  const orchestrationSelected = effectiveModel?.selectionKind === 'orchestration-engine';
  const showPermissionMode = showMode && supportedModes.length > 0;

  const summary = [
    effectiveModel?.name ??
      (models.isLoading
        ? 'Loading model…'
        : catalogUnavailable
          ? 'Model catalog unavailable'
          : selectedModelUnavailable
            ? 'Selected model unavailable — reselect'
            : 'Model unavailable'),
    supportsReasoning ? thinkingMeta(level).label : null,
    showPermissionMode ? MODE_META[mode].label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="off-composer-chip off-composer-settings-chip off-focusable"
          aria-label="Conversation settings"
          title={summary}
        >
          <Icon icon={SlidersHorizontal} size="sm" />
          <span className="off-composer-chip-text">{summary}</span>
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="off-composer-menu">
        {contextLabel ? (
          <>
            <DropdownMenuLabel className="off-composer-menu-provider">
              {contextLabel}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon icon={Bot} size="sm" />
            <span className="off-composer-menu-row">
              <span className="off-composer-menu-name">
                {orchestrationSelected ? 'Engine' : 'Model'}
              </span>
              <span className="off-composer-menu-meta">
                {effectiveModel?.name ??
                  (catalogUnavailable
                    ? 'Catalog unavailable'
                    : selectedModelUnavailable
                      ? 'Reselect model'
                      : 'Unavailable')}
              </span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="off-composer-menu off-composer-model-menu">
            <DropdownMenuLabel>
              {orchestrationSelected
                ? 'Engine for this conversation'
                : 'Engine and model for this conversation'}
            </DropdownMenuLabel>
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
                onValueChange={(value) => setThreadModel(threadId, value)}
              >
                {selectedModelUnavailable ? (
                  <DropdownMenuRadioItem value={perThreadModel} disabled>
                    Selected model unavailable · choose another
                  </DropdownMenuRadioItem>
                ) : null}
                {!lockedAuthority ? (
                  <DropdownMenuRadioItem value="" disabled={!defaultModel}>
                    {defaultModel ? `Default · ${defaultModel.name}` : 'Default model unavailable'}
                  </DropdownMenuRadioItem>
                ) : null}
                {accounts.length ? (
                  accounts.map((group) => (
                    <div key={group.accountId}>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="off-composer-menu-provider">
                        {group.account}
                      </DropdownMenuLabel>
                      {group.items.map((option) => {
                        const optionMeta = modelOptionMeta(option);
                        return (
                          <DropdownMenuRadioItem key={option.value} value={option.value}>
                            <span className="off-composer-menu-row">
                              <span className="off-composer-menu-name">{option.name}</span>
                              {option.selectionKind === 'api-model' ? (
                                <span className="off-composer-menu-meta" title={optionMeta}>
                                  {optionMeta}
                                </span>
                              ) : null}
                            </span>
                          </DropdownMenuRadioItem>
                        );
                      })}
                    </div>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    {models.isLoading ? 'Loading models…' : 'No available models'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuRadioGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSurface('settings')}>
              <Icon icon={SlidersHorizontal} size="sm" />
              Manage AI engines…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {supportsReasoning ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon icon={Brain} size="sm" />
              <span className="off-composer-menu-row">
                <span className="off-composer-menu-name">Reasoning</span>
                <span className="off-composer-menu-meta">{thinkingMeta(level).label}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="off-composer-menu off-composer-thinking-menu">
              <DropdownMenuLabel>Thinking level</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={level}
                onValueChange={(value) => setThreadThinking(threadId, value as ThinkingLevel)}
              >
                {reasoningLevels.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <span className="off-composer-menu-row">
                      <span className="off-composer-menu-name">{thinkingMeta(value).label}</span>
                      <span className="off-composer-menu-meta">{thinkingMeta(value).meta}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {showPermissionMode ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon icon={MODE_META[mode].icon} size="sm" />
              <span className="off-composer-menu-row">
                <span className="off-composer-menu-name">Mode</span>
                <span className="off-composer-menu-meta">{MODE_META[mode].label}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="off-composer-menu off-composer-mode-menu">
              <DropdownMenuLabel>Permission mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(value) => setThreadMode(threadId, value as PermissionMode)}
              >
                {supportedModes.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <span className="off-composer-menu-row">
                      <span className="off-composer-menu-name">{MODE_META[value].label}</span>
                      <span className="off-composer-menu-meta">{MODE_META[value].meta}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
