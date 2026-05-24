import {
  INTERACTION_MODES,
  INTERACTION_MODE_DESCRIPTION,
  INTERACTION_MODE_LABEL,
  type InteractionMode,
} from '@offisim/shared-types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@offisim/ui-core';
import { ChevronDown } from 'lucide-react';

const MODE_CLASS: Record<InteractionMode, string> = {
  boss_proxy: 'border-accent bg-accent-surface text-accent',
  human_in_loop: 'border-warn bg-warn-surface text-warn',
  direct_to_employee: 'border-violet bg-violet-surface text-violet',
  yolo: 'border-ok bg-ok-surface text-ok',
};

interface SessionModeBadgeProps {
  mode: InteractionMode;
}

function SessionModeBadge({ mode }: SessionModeBadgeProps) {
  return (
    <span
      className={`inline-flex h-4 items-center rounded-r-pill border px-1.5 text-fs-meta font-black uppercase tracking-wide ${MODE_CLASS[mode]}`}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-5 gap-1 rounded-r-pill border-line-soft bg-surface-2 px-1.5 text-ink-3 hover:bg-surface-sunken hover:text-ink-1"
          title="Switch session mode"
          aria-label="Switch session mode"
        >
          <SessionModeBadge mode={current} />
          <ChevronDown className="size-3 text-ink-4" />
        </Button>
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
              <span className="block text-fs-meta font-semibold text-ink-1">
                {INTERACTION_MODE_LABEL[mode]}
              </span>
              <span className="block text-fs-meta leading-snug text-ink-3">
                {INTERACTION_MODE_DESCRIPTION[mode]}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
