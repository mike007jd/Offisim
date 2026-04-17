import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { useMemo } from 'react';
import { outfitColorFromSeed } from '../../lib/avatar-seed';

interface DicebearAvatarProps {
  seed: string;
  size?: number;
  className?: string;
}

export function DicebearAvatar({ seed, size = 48, className = '' }: DicebearAvatarProps) {
  const dataUri = useMemo(() => {
    const clothesHex = outfitColorFromSeed(seed).slice(1);
    const avatar = createAvatar(avataaars, {
      seed,
      size,
      clothesColor: [clothesHex],
    });
    return avatar.toDataUri();
  }, [seed, size]);

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
