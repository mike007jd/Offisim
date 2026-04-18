import { lookupExternalBrand } from '../../lib/brand-registry';

interface BrandAvatar2DProps {
  brandKey: string | null;
  size?: number;
  className?: string;
}

/**
 * External-employee counterpart to `DicebearAvatar`. Passing an internal
 * employee here silently renders the custom fallback — route internal
 * identities through `DicebearAvatar` instead.
 */
export function BrandAvatar2D({ brandKey, size = 48, className = '' }: BrandAvatar2DProps) {
  const entry = lookupExternalBrand(brandKey);
  return (
    <img
      src={entry.asset2dUri}
      alt={entry.displayName}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
