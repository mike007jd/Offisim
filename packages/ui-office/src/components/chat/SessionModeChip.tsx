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
  boss_proxy: 'boss_proxy',
  human_in_loop: 'human_in_loop',
  direct_to_employee: 'direct_to_employee',
  yolo: 'yolo',
};

interface SessionModeBadgeProps {
  mode: InteractionMode;
}

function SessionModeBadge({ mode }: SessionModeBadgeProps) {
  return (
    <span className="session-mode-badge" data-mode={MODE_CLASS[mode]}>
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
          className="session-mode-trigger"
          title="Switch session mode"
          aria-label="Switch session mode"
        >
          <SessionModeBadge mode={current} />
          <ChevronDown data-icon="chevron" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="session-mode-menu">
        {INTERACTION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode}
            onSelect={() => {
              void onChange(mode);
            }}
            className="session-mode-item"
          >
            <SessionModeBadge mode={mode} />
            <span className="session-mode-copy">
              <span className="session-mode-label">{INTERACTION_MODE_LABEL[mode]}</span>
              <span className="session-mode-description">{INTERACTION_MODE_DESCRIPTION[mode]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
