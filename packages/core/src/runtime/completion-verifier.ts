export interface RecentToolResult {
  readonly toolName: string;
  readonly success: boolean;
  readonly bytes: number;
}

export type VerifyOutcome = { ok: true } | { ok: false; reason: string };

export interface VerifyCompletionInput {
  readonly recentToolResults: readonly RecentToolResult[];
}

export interface VerifyCompletionOptions {
  readonly evidenceTools?: readonly string[];
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
  const windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const window = input.recentToolResults.slice(-windowSize);
  const evidence = window.filter((result) => evidenceTools.has(result.toolName));

  if (evidence.length === 0) {
    return { ok: false, reason: 'No verification evidence tool ran before completion.' };
  }
  if (evidence.some((result) => result.success)) {
    return { ok: true };
  }
  return { ok: false, reason: 'Verification evidence tools ran but did not succeed.' };
}
