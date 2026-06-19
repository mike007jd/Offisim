import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Check, Wrench, X } from 'lucide-react';

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Renders an assistant-ui `tool-call` content part as a compact inline tool
 * step in the message stream (tool name + lifecycle status + duration). The Pi
 * host does not forward tool args/output to the renderer yet, so this shows the
 * tool identity and status only — enough to make a working agent visibly run
 * its tools inside the reply instead of only in the composer strip.
 */
export function ToolCallPart({
  name,
  status,
  durationMs,
}: {
  name: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}) {
  return (
    <div className={cn('off-msg-tool', `is-${status}`)}>
      <Icon icon={Wrench} size="sm" className="off-msg-tool-icon" />
      <span className="off-msg-tool-name">{name}</span>
      {status === 'running' ? (
        <span className="off-msg-tool-status">running…</span>
      ) : status === 'failed' ? (
        <>
          <Icon icon={X} size="sm" className="off-msg-tool-fail" />
          <span className="off-msg-tool-status">failed</span>
        </>
      ) : (
        <>
          <Icon icon={Check} size="sm" className="off-msg-tool-ok" />
          {durationMs != null ? (
            <span className="off-msg-tool-dur">{formatDuration(durationMs)}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Derive the render status from an assistant-ui tool-call part's result slot:
 *  no result → still running; result carries our {ok,durationMs} envelope. */
export function toolCallPartView(result: unknown): {
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
} {
  if (!result || typeof result !== 'object') return { status: 'running' };
  const envelope = result as { ok?: boolean; durationMs?: number };
  return {
    status: envelope.ok === false ? 'failed' : 'completed',
    durationMs: envelope.durationMs,
  };
}
