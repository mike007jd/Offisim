import type { RecentToolResult } from './completion-verifier.js';

export type HookEvent =
  | 'graph.node.before'
  | 'graph.node.after'
  | 'task.assigned'
  | 'task.completion.verifying'
  | 'task.completed'
  | 'tool.before'
  | 'tool.after'
  | 'interaction.created'
  | 'interaction.resolved';

export interface TaskCompletionVerifyingPayload {
  taskRunId: string;
  employeeId: string;
  recentToolResults: ReadonlyArray<RecentToolResult>;
  allow: () => void;
  block: (reason: string) => void;
}

export interface HookDefinition {
  event: HookEvent;
  name: string;
  handler: (payload: Record<string, unknown>) => Promise<void>;
  timeout?: number;
}

export interface ToolBeforeResult {
  readonly blocked: boolean;
  readonly reason?: string;
  readonly input?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HookRegistry {
  private readonly hooks = new Set<HookDefinition>();

  register(hook: HookDefinition): () => void {
    this.hooks.add(hook);
    return () => {
      this.hooks.delete(hook);
    };
  }

  async emit(event: HookEvent, payload: Record<string, unknown>): Promise<void> {
    if (this.hooks.size === 0) return;
    const hooks = [...this.hooks].filter((hook) => hook.event === event);
    await Promise.allSettled(
      hooks.map((hook) =>
        this.runHook(hook, payload).catch((error) => {
          console.warn(`[HookRegistry] hook "${hook.name}" failed for ${event}`, error);
        }),
      ),
    );
  }

  async runToolBefore(payload: {
    toolName: string;
    input: Record<string, unknown>;
    threadId: string;
    employeeId?: string;
  }): Promise<ToolBeforeResult> {
    let blockedReason: string | null = null;
    let nextInput = payload.input;
    await this.emit('tool.before', {
      ...payload,
      allow: () => {
        blockedReason = null;
      },
      block: (reason: string) => {
        blockedReason = reason || 'Blocked by tool.before hook.';
      },
      updateInput: (input: Record<string, unknown>) => {
        nextInput = input;
      },
    });
    return blockedReason
      ? { blocked: true, reason: blockedReason }
      : { blocked: false, input: nextInput };
  }

  private async runHook(hook: HookDefinition, payload: Record<string, unknown>): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        hook.handler(payload),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Timed out after ${hook.timeout ?? DEFAULT_TIMEOUT_MS}ms`));
          }, hook.timeout ?? DEFAULT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
