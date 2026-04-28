import type { LlmMessage } from '../llm/gateway.js';

export interface ForkSubContextInput {
  readonly subTask: string;
  readonly runChild: (
    childMessages: readonly LlmMessage[],
  ) => Promise<{ summary: string; transcript: readonly LlmMessage[]; childTokensUsed?: number }>;
}

export interface ForkSubContextResult {
  readonly summary: string;
  readonly childTokensUsed?: number;
}

export async function forkSubContext(input: ForkSubContextInput): Promise<ForkSubContextResult> {
  const childMessages: readonly LlmMessage[] = [{ role: 'user', content: input.subTask }];
  const child = await input.runChild(childMessages);
  return {
    summary: child.summary,
    ...(typeof child.childTokensUsed === 'number'
      ? { childTokensUsed: child.childTokensUsed }
      : {}),
  };
}
