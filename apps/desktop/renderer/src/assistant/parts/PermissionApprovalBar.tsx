import { isTauriRuntime } from '@/data/adapters.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { invoke } from '@tauri-apps/api/core';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * In-thread approval bar for the "Ask" permission mode. When the host pauses a
 * destructive tool it raises a `pendingApproval` in the run store; this bar
 * surfaces the tool/command + reason and routes the user's verdict back to the
 * paused host through `pi_agent_permission_decision`. It lives in the chat
 * column next to RunActivityStrip and self-hides when there is no pending
 * prompt. Single-slot by construction: the gated host path runs one tool at a
 * time, so only the active thread's run can have an open prompt.
 */
export function PermissionApprovalBar() {
  const pending = useRunStore((s) => s.pendingApproval);
  const clearPendingApproval = useRunStore((s) => s.clearPendingApproval);
  const [deciding, setDeciding] = useState(false);

  if (!pending) return null;

  const decide = async (approved: boolean) => {
    setDeciding(true);
    try {
      // The decision command is a privileged Tauri invoke; in the browser
      // preview there is no host to answer, so just dismiss the prompt.
      if (isTauriRuntime()) {
        await invoke('pi_agent_permission_decision', {
          requestId: pending.requestId,
          toolCallId: pending.toolCallId,
          approved,
        });
      }
    } catch (err) {
      console.warn('[PermissionApprovalBar] permission decision failed', err);
    } finally {
      clearPendingApproval();
      setDeciding(false);
    }
  };

  return (
    <div className="off-permission-bar" aria-live="assertive" aria-label="Permission request">
      <div className="off-permission-head">
        <Icon icon={ShieldAlert} size="sm" className="off-permission-icon" />
        <span className="off-permission-lead">Approval needed</span>
        <code className="off-permission-tool">{pending.command ?? pending.toolName}</code>
      </div>
      {pending.reason ? <p className="off-permission-reason">{pending.reason}</p> : null}
      <div className="off-permission-actions">
        <Button
          variant="destructive"
          size="sm"
          disabled={deciding}
          onClick={() => void decide(false)}
        >
          Reject
        </Button>
        <Button variant="default" size="sm" disabled={deciding} onClick={() => void decide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}
