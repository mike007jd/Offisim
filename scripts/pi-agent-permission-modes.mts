/**
 * Per-conversation permission modes for the Pi agent host.
 *
 * The composer lets each conversation pick how much autonomy the agent has.
 * This is the host-side enforcement that turns that pick into real tool gating
 * on the live Pi session (`scripts/tauri-pi-agent-host.entry.mjs`). The modes:
 *
 * - `plan` — read-only investigation. The tool set is restricted to the
 *   read-only built-ins (`read`/`grep`/`find`/`ls`); there is no `bash`/`edit`/
 *   `write`, so the agent can read and search to propose a plan but cannot run
 *   commands or mutate anything. Enforced purely by the tool allowlist — no
 *   runtime gate needed because the dangerous tools are never exposed.
 * - `auto` — autonomous, with a catastrophe guard. The full tool set is enabled;
 *   a bash gate blocks only the irreversible/dangerous variants (catastrophic
 *   system damage, recursive deletes against unsafe targets, git force-push) and
 *   lets normal destructive-but-recoverable work through (local `rm -rf`, a
 *   normal `git push`, writes). This is the sane leave-it-on default.
 * - `full` — no restriction. The default tool set runs with no gate.
 *
 * The dangerous-command decision reuses the hardened classifier shared with the
 * rest of Offisim (`classifyShellCommand`) rather than a fresh regex denylist —
 * it already folds NFKC homoglyphs, peels `sudo`/`env` wrappers, and scans
 * `$(...)`/backtick substitution bodies, all of which a naive gate would miss.
 *
 * This module is deliberately free of any Pi SDK import so it stays runnable
 * under plain `tsx` (the gate test) — the SDK-coupled `tool_call` handler that
 * turns the Auto decision into a real Pi extension lives in the host entry.
 */
import { classifyShellCommand } from '../packages/core/src/tools/builtin/shell-command-classifier.ts';

export type PermissionMode = 'plan' | 'ask' | 'auto' | 'full';

const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'ask', 'auto', 'full'];

/** When a conversation has not picked a mode, run autonomous-with-guard. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';

/**
 * Tools a Plan-mode agent may use: read-only investigation only. `bash`, `edit`
 * and `write` are excluded entirely, so Plan needs no runtime gate — the agent
 * simply has no tool that can mutate or execute. Mirrors Pi's read-only tool set.
 */
export const PLAN_TOOL_ALLOWLIST: readonly string[] = ['read', 'grep', 'find', 'ls'];

export function normalizePermissionMode(value: unknown): PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
    ? (value as PermissionMode)
    : DEFAULT_PERMISSION_MODE;
}

/**
 * The explicit tool allowlist for a mode, or `undefined` to keep Pi's default
 * tool set. Only Plan restricts; Auto/Full run the full built-in tools.
 */
export function toolAllowlistForMode(mode: PermissionMode): string[] | undefined {
  return mode === 'plan' ? [...PLAN_TOOL_ALLOWLIST] : undefined;
}

/**
 * Detect a git force-push in any segment of a command. `classifyShellCommand`
 * lumps every `git push` into a soft `ask`; Auto needs the finer line that
 * blocks the history-rewriting variant while letting a normal push through.
 * NFKC-folded first so a homoglyph `ｇit push --force` can't slip past.
 */
export function isGitForcePush(command: string): boolean {
  const normalized = command.normalize('NFKC');
  for (const segment of normalized.split(/(?:&&|\|\||;|\||\n|\r)/u)) {
    const s = segment.trim();
    if (!/\bgit\b/u.test(s) || !/\bpush\b/u.test(s)) continue;
    if (/--force(?:-with-lease)?\b/u.test(s)) return true;
    // Short flag carrying `f` (`-f`, `-fu`) — but not the long `--force` already
    // covered above, and not a lone `--`.
    if (/(?:^|\s)-[A-Za-z]*f[A-Za-z]*(?:\s|$)/u.test(s)) return true;
    // `git push origin +branch` refspec force.
    if (/\bpush\b[^|&;]*\s\+[\w./@~-]+(?:\s|$)/u.test(s)) return true;
  }
  return false;
}

export interface BashGateVerdict {
  block: boolean;
  reason?: string;
}

/**
 * The Auto-mode bash gate decision: block the irreversible/dangerous variants —
 * catastrophic system damage and recursive deletes against unsafe targets
 * (classifier `deny`), plus git force-push — while letting normal recoverable
 * work through (a normal `git push`, a local `rm -rf ./dir`, writes, commits).
 *
 * Only Auto gates bash: Plan exposes no bash tool, and Full is unrestricted.
 */
export function evaluateAutoBashCommand(command: string): BashGateVerdict {
  const verdict = classifyShellCommand(command);
  if (verdict.decision === 'deny') return { block: true, reason: verdict.reason };
  if (isGitForcePush(command)) {
    return {
      block: true,
      reason:
        'Auto mode blocks git force-push because it rewrites shared history. Switch to Full mode to allow it.',
    };
  }
  return { block: false };
}

export type AskAction = 'allow' | 'ask' | 'deny';

export interface AskGateVerdict {
  action: AskAction;
  reason?: string;
}

/**
 * The Ask-mode bash gate decision — the supervised middle ground between Auto
 * and Plan. It runs Auto's allow-list but PAUSES for the user's approval on the
 * destructive-but-recoverable band that Auto waves through unsupervised:
 *
 * - `deny` (catastrophic + unsafe-target recursive delete) → hard block, NO
 *   prompt. A fork bomb / `mkfs` / `rm -rf /` is never an "are you sure?".
 * - the classifier's `ask` band (normal `git push`, `rm -rf ./dir`, `chmod`,
 *   `git reset/clean/rebase`, `dd of=`) OR git force-push → pause and ask.
 * - everything else (reads, `npm test`, benign writes) → allow, no prompt.
 *
 * Reuses the same hardened `classifyShellCommand` + `isGitForcePush` primitives
 * as Auto, so NFKC-fold / sudo-peel / `$(...)`-scan hardening is inherited.
 */
export function evaluateAskBashCommand(command: string): AskGateVerdict {
  const verdict = classifyShellCommand(command);
  if (verdict.decision === 'deny') return { action: 'deny', reason: verdict.reason };
  if (verdict.decision === 'ask') return { action: 'ask', reason: verdict.reason };
  if (isGitForcePush(command)) {
    return {
      action: 'ask',
      reason: 'git force-push rewrites shared history — approve to proceed.',
    };
  }
  return { action: 'allow' };
}
