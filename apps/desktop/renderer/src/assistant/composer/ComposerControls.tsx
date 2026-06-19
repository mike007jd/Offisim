import { useUiState } from '@/app/ui-state.js';
import type { Employee } from '@/data/types.js';
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
import { readPiModelOverride } from '@/runtime/pi-agent-config.js';
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
  usePiThreadModeStore,
} from '@/runtime/pi-thread-mode-store.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import {
  Bot,
  ChevronDown,
  Eye,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useMemo } from 'react';
import { usePiAgentModels } from './usePiAgentModels.js';

const MODE_META: Record<PermissionMode, { label: string; icon: LucideIcon; meta: string }> = {
  plan: { label: 'Plan', icon: Eye, meta: 'Read-only — investigate, no changes' },
  auto: { label: 'Auto', icon: ShieldCheck, meta: 'Autonomous — blocks destructive commands' },
  full: { label: 'Full', icon: Zap, meta: 'No restrictions' },
};

function shortModelName(value: string): string {
  if (!value) return 'Auto';
  const tail = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  return tail || value;
}

/**
 * Conversation scope (the real "mode" axis in Offisim): a team thread reaches
 * the whole roster, a direct thread targets one teammate. Scope is fixed at the
 * draft's first message, so this is an editable picker only on a draft and a
 * truthful read-only chip afterward — never a fake mid-thread switch.
 */
export function ScopeControl({
  isDraft,
  scopeEmployeeId,
  employees,
}: {
  isDraft: boolean;
  scopeEmployeeId: string | null;
  employees: readonly Employee[];
}) {
  const setDraftEmployee = useUiState((s) => s.setDraftEmployee);
  const current = scopeEmployeeId ? employees.find((e) => e.id === scopeEmployeeId) : null;
  const label = current ? current.name : 'Team';
  const ScopeIcon = current ? User : Users;

  if (!isDraft) {
    return (
      <span
        className="off-composer-chip is-static"
        title={current ? `Direct conversation with ${current.name}` : 'Team conversation'}
      >
        <Icon icon={ScopeIcon} size="sm" />
        <span className="off-composer-chip-text">{label}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="off-composer-chip off-focusable"
          aria-label="Conversation scope"
        >
          <Icon icon={ScopeIcon} size="sm" />
          <span className="off-composer-chip-text">{label}</span>
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="off-composer-menu">
        <DropdownMenuLabel>Conversation scope</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scopeEmployeeId ?? ''}
          onValueChange={(value) => setDraftEmployee(value || null)}
        >
          <DropdownMenuRadioItem value="">Whole team</DropdownMenuRadioItem>
          {employees.map((employee) => (
            <DropdownMenuRadioItem key={employee.id} value={employee.id}>
              <span className="off-composer-menu-row">
                <span className="off-composer-menu-name">{employee.name}</span>
                <span className="off-composer-menu-meta">{employee.role}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Per-conversation Pi model picker. Sticky per-thread (not per-message — the
 * single-shot host has no live session to retarget). Lists only models Pi has
 * auth for; "Auto" defers to the global Settings override, then Pi's default.
 */
export function ModelControl({ threadId }: { threadId: string }) {
  const perThread = usePiThreadModelStore((s) => s.byThread[threadId] ?? '');
  const setThreadModel = usePiThreadModelStore((s) => s.setThreadModel);
  const models = usePiAgentModels();
  const setSurface = useUiState((s) => s.setSurface);
  // Derive the effective model + provider-grouped list once per change. The
  // composer subtree re-renders on every keystroke and run-state tick, so this
  // keeps the grouping (and the localStorage override read) off the hot path.
  const { providers, effective, hasReasoning } = useMemo(() => {
    const list = models.data ?? [];
    const effectiveModel = perThread || readPiModelOverride();
    const groups = new Map<string, typeof list>();
    for (const option of list) {
      const existing = groups.get(option.provider);
      if (existing) existing.push(option);
      else groups.set(option.provider, [option]);
    }
    return {
      effective: effectiveModel,
      hasReasoning: list.find((option) => option.value === effectiveModel)?.reasoning ?? false,
      providers: [...groups].map(([provider, items]) => ({ provider, items })),
    };
  }, [perThread, models.data]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="off-composer-chip off-focusable"
          aria-label="Model for this conversation"
        >
          <Icon icon={Bot} size="sm" />
          <span className="off-composer-chip-text">{shortModelName(effective)}</span>
          {hasReasoning ? (
            <Icon icon={Sparkles} size="sm" className="off-composer-chip-flag" />
          ) : null}
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="off-composer-menu off-composer-model-menu">
        <DropdownMenuLabel>Model for this conversation</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={perThread}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Per-conversation permission mode. Picks how much autonomy the agent has on
 * this thread: Plan (read-only investigation), Auto (autonomous but blocks
 * destructive commands — the default), or Full (no restrictions). The host
 * enforces the choice as real Pi tool gating; this only stores and forwards it.
 */
export function ModeControl({ threadId }: { threadId: string }) {
  const mode = usePiThreadModeStore((s) => s.byThread[threadId] ?? DEFAULT_PERMISSION_MODE);
  const setThreadMode = usePiThreadModeStore((s) => s.setThreadMode);
  const current = MODE_META[mode];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="off-composer-chip off-focusable"
          aria-label="Permission mode for this conversation"
        >
          <Icon icon={current.icon} size="sm" />
          <span className="off-composer-chip-text">{current.label}</span>
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="off-composer-menu off-composer-mode-menu">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
