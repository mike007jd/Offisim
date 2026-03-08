import type { ToolDef } from '../llm/gateway.js';

export interface ToolCallRequest {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: string;
}

export interface ToolExecutor {
  execute(call: ToolCallRequest): Promise<ToolCallResponse>;
  listAvailable(companyId: string): Promise<ToolDef[]>;
}

/** Phase 2.0 mock — returns static results */
export class MockToolExecutor implements ToolExecutor {
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      success: true,
      result: { mock: true, tool: call.name, args: call.arguments },
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [];
  }
}
