import type { LlmMessage } from '../llm/gateway.js';
import type { ToolDef } from '../llm/gateway.js';

export interface ForkSubContextInput {
  readonly subTask: string;
  readonly scopedTools?: readonly ToolDef[];
  readonly runChild: (
    childMessages: readonly LlmMessage[],
    scopedTools: readonly ToolDef[],
  ) => Promise<{ summary: string; transcript: readonly LlmMessage[]; childTokensUsed?: number }>;
}

export interface ForkSubContextResult {
  readonly summary: string;
  readonly childTokensUsed?: number;
}

export async function forkSubContext(input: ForkSubContextInput): Promise<ForkSubContextResult> {
  const childMessages: readonly LlmMessage[] = [{ role: 'user', content: input.subTask }];
  const child = await input.runChild(childMessages, input.scopedTools ?? []);
  return {
    summary: child.summary,
    ...(typeof child.childTokensUsed === 'number'
      ? { childTokensUsed: child.childTokensUsed }
      : {}),
  };
}
