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
import { SessionModeBadge } from './SessionModeBadge';

export interface SessionModeSwitcherProps {
  current: InteractionMode;
  onChange: (mode: InteractionMode) => void | Promise<void>;
}

export function SessionModeSwitcher({ current, onChange }: SessionModeSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="cyber-button inline-flex h-8 items-center gap-1.5 px-2.5 py-0 normal-case tracking-normal"
          title="Switch session mode"
          aria-label="Switch session mode"
        >
          <SessionModeBadge mode={current} />
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
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
              <span className="block text-xs font-semibold text-slate-100">
                {INTERACTION_MODE_LABEL[mode]}
              </span>
              <span className="block text-[11px] leading-snug text-slate-400">
                {INTERACTION_MODE_DESCRIPTION[mode]}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
