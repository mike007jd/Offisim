import type { ReactNode } from 'react';

interface RightSidebarProps {
  chatPanel: ReactNode;
}

/**
 * Single-axis Office right rail (V3). The legacy Chat/Inspector/Tasks/Git tab
 * shell is removed: the rail is now one conversation column. Inspector routes to
 * Personnel; Tasks content (Activity/Plan) is folded into the chat column's
 * run-record head and `.conv-outputs`.
 */
export function RightSidebar({ chatPanel }: RightSidebarProps) {
  return (
    <div className="box-border flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-surface-elevated text-text-primary">
      <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {chatPanel}
      </div>
    </div>
  );
}
