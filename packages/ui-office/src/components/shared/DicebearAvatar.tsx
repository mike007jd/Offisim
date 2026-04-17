import { useMemo } from 'react';
import { createOffisimAvatar } from '../../lib/avatar-seed';

interface DicebearAvatarProps {
  seed: string;
  size?: number;
  className?: string;
}

export function DicebearAvatar({ seed, size = 48, className = '' }: DicebearAvatarProps) {
  const dataUri = useMemo(() => createOffisimAvatar(seed, size), [seed, size]);

  return (
    <img
      src={dataUri}
      alt={seed}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
