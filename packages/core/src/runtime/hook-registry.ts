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
    // Per-hook .catch isolates one failing hook; Promise.all (not allSettled)
    // is fine because no branch can reject after the catch swallows the error.
    await Promise.all(
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
    // Gate semantics: any deny is terminal. Run tool.before hooks sequentially
    // so the result is order-independent — a later allow() can never undo an
    // earlier block(), and updateInput rewrites apply deterministically in
    // registration order before the first block short-circuits.
    let blockedReason: string | null = null;
    let nextInput = payload.input;
    const hooks = [...this.hooks].filter((hook) => hook.event === 'tool.before');
    for (const hook of hooks) {
      const hookPayload = {
        ...payload,
        input: nextInput,
        allow: () => {},
        block: (reason: string) => {
          blockedReason = reason || 'Blocked by tool.before hook.';
        },
        updateInput: (input: Record<string, unknown>) => {
          nextInput = input;
        },
      };
      await this.runHook(hook, hookPayload).catch((error) => {
        console.warn(`[HookRegistry] hook "${hook.name}" failed for tool.before`, error);
      });
      if (blockedReason) break;
    }
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
