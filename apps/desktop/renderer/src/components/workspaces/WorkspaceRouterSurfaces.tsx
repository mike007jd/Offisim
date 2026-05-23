import { cn } from '@offisim/ui-core';
import type { HTMLAttributes, ReactNode } from 'react';

interface WorkspaceOfficeSceneHostProps extends HTMLAttributes<HTMLDivElement> {
  interactive: boolean;
  children: ReactNode;
}

export function WorkspaceOfficeSceneHost({
  interactive,
  className,
  children,
  ...props
}: WorkspaceOfficeSceneHostProps) {
  return (
    <div
      {...props}
      data-slot="workspace-office-scene-host"
      data-interactive={interactive}
      className={cn('workspace-office-scene-host', className)}
      aria-hidden={!interactive}
    >
      {children}
    </div>
  );
}
