import { Icon } from '@/design-system/icons/Icon.js';
import { type EmployeeAppearance, employeeAvatarUri } from '@/lib/avatar.js';
import { cn } from '@/lib/utils.js';
import { Bot } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';

interface EmployeeAvatarProps {
  seed: string;
  colorA: string;
  colorB: string;
  appearance?: EmployeeAppearance;
  size?: number;
  brand?: boolean;
  className?: string;
}

/** Employee avatar: a DiceBear `avataaars` character framed in the V3 block tile.
 *  External (brand) agents render a glyph instead of a generated face. */
export function EmployeeAvatar({
  seed,
  colorA,
  colorB,
  appearance,
  size = 30,
  brand = false,
  className,
}: EmployeeAvatarProps) {
  const uri = useMemo(
    () => (brand ? null : employeeAvatarUri(seed, appearance)),
    [seed, appearance, brand],
  );
  const avatarStyle = {
    '--off-av-size': `${size}px`,
    '--off-av-a': colorA,
    '--off-av-b': colorB,
  } as CSSProperties;

  return (
    <span className={cn('off-av', className)} style={avatarStyle} aria-hidden>
      {uri ? (
        <img className="off-av-img" src={uri} alt="" draggable={false} />
      ) : (
        <Icon icon={Bot} size="sm" />
      )}
    </span>
  );
}
