import { cn } from '@offisim/ui-core';
import type { HTMLAttributes } from 'react';

export function AppResumeBannerHost({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-slot="app-resume-banner-host"
      className={cn('app-resume-banner-host', className)}
    />
  );
}

export function AppOverlayPortalHost({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-slot="app-overlay-portal-host"
      className={cn('app-overlay-portal-host', className)}
    />
  );
}
