import { Avatar, AvatarFallback, cn } from '@offisim/ui-core';

const ROLE_AVATAR_TONE: Record<string, string> = {
  developer: 'bg-accent',
  engineer: 'bg-accent',
  backend: 'bg-accent',
  frontend: 'bg-accent',
  fullstack: 'bg-accent',
  pm: 'bg-accent',
  product_manager: 'bg-accent',
  researcher: 'bg-ok',
  analyst: 'bg-ok',
  designer: 'bg-warn',
  artist: 'bg-warn',
  ui_designer: 'bg-warn',
  ux_designer: 'bg-warn',
};

function roleAvatarTone(role: string): string {
  return ROLE_AVATAR_TONE[role] ?? 'bg-ink-3';
}

export interface AgentAvatarProps {
  name: string;
  role: string;
  className?: string;
}

export function AgentAvatar({ name, role, className }: AgentAvatarProps) {
  return (
    <Avatar size="sm" ring="none" className={cn('chat-composer-menu-avatar', className)}>
      <AvatarFallback className={cn('text-accent-fg', roleAvatarTone(role))}>
        {name[0] ?? ''}
      </AvatarFallback>
    </Avatar>
  );
}
