import { Avatar, AvatarFallback, cn } from '@offisim/ui-core';

const ROLE_AVATAR_TONE: Record<string, string> = {
  developer: 'bg-info',
  engineer: 'bg-info',
  backend: 'bg-info',
  frontend: 'bg-accent',
  fullstack: 'bg-info',
  pm: 'bg-accent',
  product_manager: 'bg-accent',
  researcher: 'bg-success',
  analyst: 'bg-success',
  designer: 'bg-warning',
  artist: 'bg-warning',
  ui_designer: 'bg-warning',
  ux_designer: 'bg-warning',
};

function roleAvatarTone(role: string): string {
  return ROLE_AVATAR_TONE[role] ?? 'bg-text-muted';
}

export interface AgentAvatarProps {
  name: string;
  role: string;
  className?: string;
}

export function AgentAvatar({ name, role, className }: AgentAvatarProps) {
  return (
    <Avatar size="sm" ring="none" className={cn('chat-composer-menu-avatar', className)}>
      <AvatarFallback className={cn('text-text-inverse', roleAvatarTone(role))}>
        {name[0] ?? ''}
      </AvatarFallback>
    </Avatar>
  );
}
