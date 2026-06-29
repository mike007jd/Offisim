/**
 * Per-conversation permission modes for the Pi agent host.
 *
 * The composer lets each conversation pick how much autonomy the agent has.
 * This is the host-side enforcement that turns that pick into real tool gating
 * on the live Pi session (`scripts/tauri-pi-agent-host.entry.mjs`). The modes:
 *
 * - `plan` — read-only investigation. The tool set is restricted to read-only
 *   built-ins plus read-class MCP meta tools when scoped; there is no `bash`/
 *   `edit`/`write`, so the agent can research to propose a plan but cannot run
 *   commands or mutate anything.
 * - `ask` — supervised execution. The full tool set is enabled; catastrophic
 *   commands are hard-blocked, and recoverable destructive commands pause on
 *   Pi's extension UI until the renderer sends an approval response.
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
 * turns the Auto/Ask decisions into a real Pi extension lives in the host entry.
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
 * tool set. Only Plan restricts; Ask/Auto/Full run the full built-in tools.
 */
export function toolAllowlistForMode(mode: PermissionMode): string[] | undefined {
  return mode === 'plan' ? [...PLAN_TOOL_ALLOWLIST] : undefined;
}

// ── Collaboration profiles (Connect) — Epic E ───────────────────────────────
//
// Connect (company chat) runs isolated from Office work: `strict` is the
// current zero-tools daily-chat profile. `collaboration_read` is a third profile
// BETWEEN strict and full work mode — a read-only personal-assistant context that
// may read/search + (E2) call read-only MCP connectors (calendar/inbox/memory/
// web), but must NEVER write files, run shell, persist a mission/run, or publish
// an artifact. This module defines the allowlist + the forbidden-tool invariant;
// the live host wiring + read-only MCP + UI toggle land in E2.

export type CollaborationProfile = 'strict' | 'collaboration_read';

const COLLABORATION_PROFILES: readonly CollaborationProfile[] = ['strict', 'collaboration_read'];

/** Default Connect profile: the existing zero-tools daily chat. */
export const DEFAULT_COLLABORATION_PROFILE: CollaborationProfile = 'strict';

/**
 * Built-in tools for `collaboration_read`. Empty until Offisim has an explicit
 * folder/project source grant; read-only MCP connectors are appended at scope
 * time. This prevents Connect from reading the neutral cwd by default.
 */
export const COLLABORATION_READ_TOOL_ALLOWLIST: readonly string[] = [];

/**
 * Tools a collaboration profile may NEVER expose — the read-only invariant. Any
 * intersection of a collaboration allowlist with this set is an isolation breach
 * (write / shell / mission persistence / publish / run-spawning).
 */
export const COLLABORATION_FORBIDDEN_TOOLS: readonly string[] = [
  'write',
  'edit',
  'bash',
  'publish_artifact',
  'submit_for_evaluation',
  'query_mission_state',
  'delegate',
];

export function normalizeCollaborationProfile(value: unknown): CollaborationProfile {
  return typeof value === 'string' && (COLLABORATION_PROFILES as readonly string[]).includes(value)
    ? (value as CollaborationProfile)
    : DEFAULT_COLLABORATION_PROFILE;
}

/**
 * The explicit tool allowlist for a collaboration profile. `strict` → `[]` (the
 * current zero-tools Connect). `collaboration_read` → the read-only built-ins.
 * Always an explicit list (never Pi's default set) — Connect never runs the full
 * tool set.
 */
export function collaborationToolAllowlist(profile: CollaborationProfile): string[] {
  return profile === 'collaboration_read' ? [...COLLABORATION_READ_TOOL_ALLOWLIST] : [];
}

/**
 * The read-only invariant: a collaboration allowlist must not intersect the
 * forbidden set. Returns the offending tools (empty when the allowlist is safe).
 */
export function collaborationForbiddenIntersection(tools: readonly string[]): string[] {
  const forbidden = new Set(COLLABORATION_FORBIDDEN_TOOLS);
  return tools.filter((t) => forbidden.has(t));
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
