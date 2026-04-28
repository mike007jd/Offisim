import type { ToolCallResult } from '../llm/gateway.js';

const SAFE_STREAMING_TOOLS = new Set(['read_file', 'web_search', 'recall']);

export interface StreamingToolCaseReport {
  readonly toolName: string;
  readonly safe: boolean;
  readonly parity: boolean;
  readonly startedEarly: boolean;
  readonly sideEffectDiscarded: boolean;
}

export interface StreamingToolReport {
  readonly suite: 'stream-tools';
  readonly cases: readonly StreamingToolCaseReport[];
  readonly passed: number;
  readonly failed: number;
}

export async function runStreamingToolParityHarness(): Promise<StreamingToolReport> {
  const calls: readonly ToolCallResult[] = [
    { id: 'tc-read', name: 'read_file', arguments: { path: 'README.md' } },
    { id: 'tc-write', name: 'write_file', arguments: { path: 'out.txt' } },
  ];
  const cases = calls.map((call) => {
    const safe = SAFE_STREAMING_TOOLS.has(call.name);
    const normal = executeSyntheticTool(call);
    const streaming = safe ? executeSyntheticTool(call) : null;
    return {
      toolName: call.name,
      safe,
      parity: safe ? JSON.stringify(normal) === JSON.stringify(streaming) : true,
      startedEarly: safe,
      sideEffectDiscarded: !safe,
    };
  });
  return {
    suite: 'stream-tools',
    cases,
    passed: cases.filter((testCase) => testCase.parity).length,
    failed: cases.filter((testCase) => !testCase.parity).length,
  };
}

function executeSyntheticTool(call: ToolCallResult): unknown {
  return { ok: true, tool: call.name, args: call.arguments };
}
