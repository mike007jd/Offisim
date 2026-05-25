import { cn } from '@/lib/utils.js';
import type { LucideIcon } from 'lucide-react';

interface IconProps {
  icon: LucideIcon;
  size?: 'sm' | 'md';
  className?: string;
}

export function Icon({ icon: IconComponent, size = 'md', className }: IconProps) {
  return <IconComponent aria-hidden className={cn('off-icon', `off-icon-${size}`, className)} />;
}
