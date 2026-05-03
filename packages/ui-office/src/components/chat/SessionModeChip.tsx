import {
  INTERACTION_MODES,
  INTERACTION_MODE_DESCRIPTION,
  INTERACTION_MODE_LABEL,
  type InteractionMode,
} from '@offisim/shared-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';

const MODE_COLOR: Record<InteractionMode, string> = {
  boss_proxy: 'var(--color-foam)',
  human_in_loop: 'var(--color-coral-orange)',
  direct_to_employee: 'var(--color-sea-blue)',
  yolo: 'var(--color-kelp-green)',
};

interface SessionModeBadgeProps {
  mode: InteractionMode;
}

function SessionModeBadge({ mode }: SessionModeBadgeProps) {
  return (
    <span
      className="inline-flex h-4 items-center rounded-full border px-1.5 text-[9px] font-black uppercase tracking-wider"
      style={{
        borderColor: `color-mix(in srgb, ${MODE_COLOR[mode]} 55%, transparent)`,
        background: `color-mix(in srgb, ${MODE_COLOR[mode]} 14%, transparent)`,
        color: MODE_COLOR[mode],
      }}
    >
      {INTERACTION_MODE_LABEL[mode]}
    </span>
  );
}

export interface SessionModeChipProps {
  current: InteractionMode;
  onChange: (mode: InteractionMode) => void | Promise<void>;
}

export function SessionModeChip({ current, onChange }: SessionModeChipProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 items-center gap-1 rounded-full border border-border-subtle bg-surface-muted px-1.5 text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
          title="Switch session mode"
          aria-label="Switch session mode"
        >
          <SessionModeBadge mode={current} />
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-72">
        {INTERACTION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode}
            onSelect={() => {
              void onChange(mode);
            }}
            className="flex items-start gap-3"
          >
            <SessionModeBadge mode={mode} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-text-primary">
                {INTERACTION_MODE_LABEL[mode]}
              </span>
              <span className="block text-[11px] leading-snug text-text-secondary">
                {INTERACTION_MODE_DESCRIPTION[mode]}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
