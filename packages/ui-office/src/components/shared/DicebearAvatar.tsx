import type { EmployeeAppearance } from '@offisim/shared-types';
import { useMemo } from 'react';
import { createOffisimAvatar } from '../../lib/avatar-seed';

interface DicebearAvatarProps {
  seed: string;
  size?: number;
  className?: string;
  appearance?: EmployeeAppearance | null;
}

export function DicebearAvatar({
  seed,
  size = 48,
  className = '',
  appearance,
}: DicebearAvatarProps) {
  const dataUri = useMemo(
    () => createOffisimAvatar(seed, size, appearance ?? undefined),
    [seed, size, appearance],
  );

  return (
    <img
      src={dataUri}
      alt={seed}
      width={size}
      height={size}
      className={`rounded-lg ${className}`}
    />
  );
}
