import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Bot, type LucideIcon } from 'lucide-react';

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
  return (
    <span
      className={cn('off-av', className)}
      style={{
        width: size,
        height: size,
        fontSize: fontSize ?? Math.round(size * 0.36),
        background: `linear-gradient(150deg, ${colorA}, ${colorB})`,
      }}
      aria-hidden
    >
      {brand ? <Icon icon={brandIcon} size="sm" /> : initials}
    </span>
  );
}
