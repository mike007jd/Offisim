import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Bot, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

interface BlockAvatarProps {
  initials: string;
  colorA: string;
  colorB: string;
  size?: number;
  fontSize?: number;
  brand?: boolean;
  brandIcon?: LucideIcon;
  className?: string;
}

export function BlockAvatar({
  initials,
  colorA,
  colorB,
  size = 30,
  fontSize,
  brand = false,
  brandIcon = Bot,
  className,
}: BlockAvatarProps) {
  const avatarStyle = {
    '--off-av-size': `${size}px`,
    '--off-av-font-size': `${fontSize ?? Math.round(size * 0.36)}px`,
    '--off-av-a': colorA,
    '--off-av-b': colorB,
  } as CSSProperties;

  return (
    <span
      className={cn('off-av', className)}
      style={avatarStyle}
      aria-hidden
    >
      {brand ? <Icon icon={brandIcon} size="sm" /> : initials}
    </span>
  );
}
