import { Icon } from '@/design-system/icons/Icon.js';
import { Button, type ButtonProps } from '@/design-system/primitives/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip.js';
import type { LucideIcon } from 'lucide-react';

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'size' | 'aria-label'> {
  icon: LucideIcon;
  label: string;
  iconSize?: 'sm' | 'md';
  size?: 'icon' | 'iconSm';
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function IconButton({
  icon,
  label,
  iconSize = 'sm',
  size = 'icon',
  side = 'bottom',
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} {...props}>
          <Icon icon={icon} size={iconSize} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
