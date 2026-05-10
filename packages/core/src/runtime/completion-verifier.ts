import type { RuntimeEvidenceClass } from '@offisim/shared-types';

export interface RecentToolResult {
  readonly toolName: string;
  readonly success: boolean;
  readonly bytes: number;
  readonly evidenceClass?: RuntimeEvidenceClass;
  readonly taskRunId?: string | null;
}

export type VerifyOutcome = { ok: true } | { ok: false; reason: string };
export type CompletionEvidenceFamily =
  | 'file'
  | 'shell'
  | 'mcp'
  | 'git-worktree'
  | 'artifact'
  | 'memory-todo-skill'
  | 'browser-desktop'
  | 'sdk-native'
  | 'gateway-bridged'
  | 'pure-text'
  | 'verification';

export interface VerifyCompletionInput {
  readonly recentToolResults: readonly RecentToolResult[];
}

export interface VerifyCompletionOptions {
  readonly evidenceTools?: readonly string[];
  readonly evidenceFamilies?: readonly CompletionEvidenceFamily[];
  readonly taskRunId?: string | null;
  readonly windowSize?: number;
}

export const DEFAULT_COMPLETION_EVIDENCE_TOOLS = [
  'pnpm-test',
  'pnpm-typecheck',
  'pnpm-lint',
  'harness-contract',
] as const;
const DEFAULT_WINDOW_SIZE = 12;

export function verifyCompletion(
  input: VerifyCompletionInput,
  opts: VerifyCompletionOptions = {},
): VerifyOutcome {
  const evidenceTools = new Set(opts.evidenceTools ?? DEFAULT_COMPLETION_EVIDENCE_TOOLS);
  const evidenceFamilies = new Set(opts.evidenceFamilies ?? []);
  const windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const window = input.recentToolResults
    .filter((result) => opts.taskRunId === undefined || result.taskRunId === opts.taskRunId)
    .slice(-windowSize);
  const evidence = window.filter(
    (result) =>
      evidenceTools.has(result.toolName) ||
      [...evidenceFamilies].some((family) => resultMatchesFamily(result, family)),
  );

  if (evidence.length === 0) {
    return { ok: false, reason: 'No verification evidence tool ran before completion.' };
  }
  if (evidence.some((result) => result.success)) {
    return { ok: true };
  }
  return { ok: false, reason: 'Verification evidence tools ran but did not succeed.' };
}

function resultMatchesFamily(result: RecentToolResult, family: CompletionEvidenceFamily): boolean {
  switch (family) {
    case 'file':
      return ['read_file', 'write_file', 'project_read_file', 'project_read_file_preview'].includes(
        result.toolName,
      );
    case 'shell':
      return result.toolName === 'bash';
    case 'mcp':
      return result.toolName.startsWith('mcp:');
    case 'git-worktree':
      return ['git_status', 'git_diff', 'git_branch', 'git_worktree'].includes(result.toolName);
    case 'artifact':
      return ['artifact_created', 'deliverable_created', 'write_file'].includes(result.toolName);
    case 'memory-todo-skill':
      return ['memory_write', 'todo_write', 'skill_install', 'skill_mutation'].includes(
        result.toolName,
      );
    case 'browser-desktop':
      return ['browser_action', 'desktop_action', 'computer_use'].includes(result.toolName);
    case 'sdk-native':
      return result.evidenceClass === 'sdk-native';
    case 'gateway-bridged':
      return result.evidenceClass === 'gateway-bridged';
    case 'pure-text':
      return result.toolName === 'pure_text';
    case 'verification':
      return DEFAULT_COMPLETION_EVIDENCE_TOOLS.includes(
        result.toolName as (typeof DEFAULT_COMPLETION_EVIDENCE_TOOLS)[number],
      );
  }
}
