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
import { readPiModelOverride } from '@/runtime/pi-agent-config.js';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
  usePiThreadModeStore,
} from '@/runtime/pi-thread-mode-store.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVELS,
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
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { useMemo } from 'react';
import { usePiAgentModels } from './usePiAgentModels.js';

const MODE_META: Record<PermissionMode, { label: string; icon: LucideIcon; meta: string }> = {
  plan: { label: 'Plan', icon: Eye, meta: 'Read-only — investigate, no changes' },
  ask: {
    label: 'Ask',
    icon: MessageCircleQuestion,
    meta: 'Pauses for your approval on destructive commands',
  },
  auto: { label: 'Auto', icon: ShieldCheck, meta: 'Autonomous — blocks destructive commands' },
  full: { label: 'Full', icon: Zap, meta: 'No restrictions' },
};

/**
 * Thinking-level labels + qualitative depth hints. Deliberately no token
 * numbers: the provider decides the real budget per level, so a "~Nk tokens"
 * figure would be false precision.
 */
const THINKING_META: Record<ThinkingLevel, { label: string; meta: string }> = {
  off: { label: 'Off', meta: 'No reasoning' },
  minimal: { label: 'Minimal', meta: 'Very brief' },
  low: { label: 'Low', meta: 'Light' },
  medium: { label: 'Medium', meta: 'Moderate' },
  high: { label: 'High', meta: 'Deep' },
  xhigh: { label: 'Max', meta: 'Maximum' },
};

function shortModelName(value: string): string {
  if (!value) return 'Auto';
  const tail = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  return tail || value;
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
}: {
  threadId: string;
  /** Quiet menu heading (e.g. the project name); omitted when empty. */
  contextLabel?: string;
}) {
  const perThreadModel = usePiThreadModelStore((s) => s.byThread[threadId] ?? '');
  const setThreadModel = usePiThreadModelStore((s) => s.setThreadModel);
  const models = usePiAgentModels();
  const setSurface = useUiState((s) => s.setSurface);
  const mode = usePiThreadModeStore((s) => s.byThread[threadId] ?? DEFAULT_PERMISSION_MODE);
  const setThreadMode = usePiThreadModeStore((s) => s.setThreadMode);
  const level = usePiThreadThinkingStore((s) => s.byThread[threadId] ?? DEFAULT_THINKING_LEVEL);
  const setThreadThinking = usePiThreadThinkingStore((s) => s.setThreadThinking);

  // Derive the effective model, provider-grouped list, and reasoning support
  // once per change. The composer subtree re-renders on every keystroke and
  // run-state tick, so this keeps the grouping (and the localStorage override
  // read) off the hot path.
  const { providers, effective, supportsReasoning } = useMemo(() => {
    const list = models.data ?? [];
    const effectiveModel = perThreadModel || readPiModelOverride();
    const groups = new Map<string, typeof list>();
    for (const option of list) {
      const existing = groups.get(option.provider);
      if (existing) existing.push(option);
      else groups.set(option.provider, [option]);
    }
    return {
      effective: effectiveModel,
      providers: [...groups].map(([provider, items]) => ({ provider, items })),
      supportsReasoning:
        list.find((option) => option.value === effectiveModel)?.reasoning ?? false,
    };
  }, [perThreadModel, models.data]);

  const summary = [
    shortModelName(effective),
    supportsReasoning ? THINKING_META[level].label : null,
    MODE_META[mode].label,
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
              <span className="off-composer-menu-name">Model</span>
              <span className="off-composer-menu-meta">{shortModelName(effective)}</span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="off-composer-menu off-composer-model-menu">
            <DropdownMenuLabel>Model for this conversation</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={perThreadModel}
              onValueChange={(value) => setThreadModel(threadId, value)}
            >
              <DropdownMenuRadioItem value="">Auto (Pi default)</DropdownMenuRadioItem>
              {providers.length ? (
                providers.map((group) => (
                  <div key={group.provider}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="off-composer-menu-provider">
                      {group.provider}
                    </DropdownMenuLabel>
                    {group.items.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        <span className="off-composer-menu-row">
                          <span className="off-composer-menu-name">{option.name}</span>
                          {option.reasoning ? (
                            <span className="off-composer-menu-meta">reasoning</span>
                          ) : null}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </div>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  {models.isLoading ? 'Loading models…' : 'No authenticated models'}
                </DropdownMenuItem>
              )}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSurface('settings')}>
              <Icon icon={SlidersHorizontal} size="sm" />
              Manage models…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {supportsReasoning ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon icon={Brain} size="sm" />
              <span className="off-composer-menu-row">
                <span className="off-composer-menu-name">Reasoning</span>
                <span className="off-composer-menu-meta">{THINKING_META[level].label}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="off-composer-menu off-composer-thinking-menu">
              <DropdownMenuLabel>Thinking level</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={level}
                onValueChange={(value) => setThreadThinking(threadId, value as ThinkingLevel)}
              >
                {THINKING_LEVELS.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <span className="off-composer-menu-row">
                      <span className="off-composer-menu-name">{THINKING_META[value].label}</span>
                      <span className="off-composer-menu-meta">{THINKING_META[value].meta}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
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
              {PERMISSION_MODES.map((value) => (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
