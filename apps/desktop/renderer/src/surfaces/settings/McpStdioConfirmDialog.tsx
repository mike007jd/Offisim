import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import type { McpServer, McpServerFormValues } from './settings-data.js';

type PendingStdio = McpServerFormValues;

interface McpStdioConfirmDialogProps {
  pending: PendingStdio | McpServer | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function resolveInfo(pending: PendingStdio | McpServer) {
  return {
    command: 'command' in pending ? pending.command : '',
    args: 'args' in pending ? pending.args : '',
    name: pending.name,
    approvalId: pending.approvalId,
  };
}

export function McpStdioConfirmDialog({
  pending,
  onConfirm,
  onCancel,
}: McpStdioConfirmDialogProps) {
  if (!pending) return null;
  const info = resolveInfo(pending);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showClose={false} className="off-dialog-w-md">
        <div className="off-set-confirm-head">
          <span className="off-set-confirm-icon">
            <Icon icon={ShieldCheck} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--off-fs-sm)] font-[660]">
              Confirm stdio MCP server
            </DialogTitle>
            <DialogDescription className="text-[length:var(--off-fs-meta)]">
              This starts a local process that can run shell commands. Review the command before
              connecting.
            </DialogDescription>
          </div>
        </div>

        <dl className="off-set-confirm-dl">
          <dt>Server</dt>
          <dd>{info.name || '—'}</dd>
          <dt>Command</dt>
          <dd>{info.command || '—'}</dd>
          <dt>Args</dt>
          <dd>{info.args ? info.args.split('\n').join(' ') : '—'}</dd>
          <dt>Source</dt>
          <dd>user-config</dd>
          <dt>Approval</dt>
          <dd>{info.approvalId || `mcp.${info.name}.default`}</dd>
        </dl>

        <div className="off-set-callout is-warn">
          <Icon icon={AlertTriangle} size="sm" />
          This server can read &amp; modify your workspace and execute shell commands. Only confirm
          sources you trust.
        </div>

        <DialogFooter>
          <Button variant="outline" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" className="off-set-btn-ok" onClick={onConfirm}>
            <Icon icon={Check} size="sm" />
            Confirm &amp; connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
