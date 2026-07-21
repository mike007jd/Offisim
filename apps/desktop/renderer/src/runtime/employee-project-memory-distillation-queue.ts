import type { AgentRunRow, RuntimeRepositories } from '@offisim/core/browser';
import { distillTerminalRunMemory } from './employee-project-memory.js';

const EMPLOYEE_PROJECT_MEMORY_DISTILLATION_TIMEOUT_MS = 30_000;

export interface EmployeeProjectMemoryDistillationJob {
  repos: RuntimeRepositories;
  run: AgentRunRow;
  status: 'completed' | 'failed';
  summary: string | null | undefined;
}

type EmployeeProjectMemoryDistiller = (
  input: EmployeeProjectMemoryDistillationJob & { signal?: AbortSignal },
) => Promise<void>;

export interface EmployeeProjectMemoryDistillationQueueOptions {
  timeoutMs?: number;
  distill?: EmployeeProjectMemoryDistiller;
  onError?: (job: EmployeeProjectMemoryDistillationJob, error: unknown) => void;
}

class EmployeeProjectMemoryDistillationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeProjectMemoryDistillationCancelledError';
  }
}

class EmployeeProjectMemoryDistillationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Employee Project experience distillation timed out after ${timeoutMs}ms.`);
    this.name = 'EmployeeProjectMemoryDistillationTimeoutError';
  }
}

/**
 * Runs derived employee-memory work outside the durable run-terminal path.
 * Jobs are serialized per runtime lane, bounded, and yield immediately to a new
 * foreground root run. A failed or cancelled derivation never changes the
 * already-committed run/message terminal state.
 */
export class EmployeeProjectMemoryDistillationQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly scheduledRunIds = new Set<string>();
  private readonly timeoutMs: number;
  private readonly distill: EmployeeProjectMemoryDistiller;
  private readonly onError: (job: EmployeeProjectMemoryDistillationJob, error: unknown) => void;
  private active: { runId: string; controller: AbortController } | null = null;

  constructor(options: EmployeeProjectMemoryDistillationQueueOptions = {}) {
    const configuredTimeout = options.timeoutMs ?? EMPLOYEE_PROJECT_MEMORY_DISTILLATION_TIMEOUT_MS;
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : EMPLOYEE_PROJECT_MEMORY_DISTILLATION_TIMEOUT_MS;
    this.distill = options.distill ?? distillTerminalRunMemory;
    this.onError =
      options.onError ??
      ((job, error) => {
        if (error instanceof EmployeeProjectMemoryDistillationCancelledError) return;
        console.warn('Employee Project experience distillation failed after run terminal.', {
          runId: job.run.run_id,
          error,
        });
      });
  }

  enqueue(job: EmployeeProjectMemoryDistillationJob): void {
    if (this.scheduledRunIds.has(job.run.run_id)) return;
    this.scheduledRunIds.add(job.run.run_id);
    const run = () => this.runJob(job);
    const outcome = this.tail.then(run, run);
    this.tail = outcome.catch((error) => {
      try {
        this.onError(job, error);
      } catch (observerError) {
        console.warn('Employee Project experience distillation error observer failed.', {
          runId: job.run.run_id,
          error: observerError,
        });
      }
    });
  }

  cancelActiveForForegroundRun(): void {
    this.active?.controller.abort(
      new EmployeeProjectMemoryDistillationCancelledError(
        'Employee Project experience distillation yielded to a foreground run.',
      ),
    );
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  private async runJob(job: EmployeeProjectMemoryDistillationJob): Promise<void> {
    const controller = new AbortController();
    this.active = { runId: job.run.run_id, controller };
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new EmployeeProjectMemoryDistillationTimeoutError(this.timeoutMs);
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });
    const abortedPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          const reason = controller.signal.reason;
          reject(
            reason instanceof Error
              ? reason
              : new EmployeeProjectMemoryDistillationCancelledError(
                  'Employee Project experience distillation was cancelled.',
                ),
          );
        },
        { once: true },
      );
    });
    const distillation = this.distill({ ...job, signal: controller.signal });
    try {
      await Promise.race([distillation, timeoutPromise, abortedPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.active?.runId === job.run.run_id) this.active = null;
    }
  }
}
