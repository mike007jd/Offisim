import { StatusPill } from '@/design-system/grammar/index.js';
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

interface PendingStdio extends McpServerFormValues {
  readonly requestedTools: readonly string[];
  readonly riskyTools: readonly string[];
}

interface McpStdioConfirmDialogProps {
  pending: PendingStdio | McpServer | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function resolveTools(pending: PendingStdio | McpServer) {
  return {
    requestedTools: pending.requestedTools,
    riskyTools: pending.riskyTools,
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
  const info = resolveTools(pending);
  const highRisk = info.riskyTools.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showClose={false} className="max-w-[520px]">
        <div className="off-set-confirm-head">
          <span className="off-set-confirm-icon">
            <Icon icon={ShieldCheck} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--off-fs-sm)] font-[660]">
              Confirm stdio MCP server
            </DialogTitle>
            <DialogDescription className="text-[length:var(--off-fs-meta)]">
              Stdio servers run arbitrary local processes. Confirm the command and requested tools
              before connecting.
            </DialogDescription>
          </div>
          <StatusPill tone={highRisk ? 'warn' : 'accent'}>
            {highRisk ? 'High risk' : 'Medium'}
          </StatusPill>
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

        <div>
          <div className="off-set-subhead">Requested tools · {info.requestedTools.length}</div>
          <div className="off-set-tool-grid">
            {info.requestedTools.map((tool) => (
              <div key={tool}>
                {tool}
                {info.riskyTools.includes(tool) ? (
                  <span className="off-set-tool-risk">risk</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

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
