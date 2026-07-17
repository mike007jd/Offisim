import type { RunFailureKind } from '@offisim/shared-types';

export const DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS = 105_000;
const NATIVE_STREAM_RECOVERY_TIMEOUT_MS = 10_000;

export interface StreamWatchdogScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemScheduler: StreamWatchdogScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class NativeStreamIdleTimeoutError extends Error {
  readonly failureKind: RunFailureKind = 'runtime';

  constructor(
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(
      `Agent runtime stream made no progress for ${Math.round(timeoutMs / 1_000)} seconds and could not be recovered.`,
    );
    this.name = 'NativeStreamIdleTimeoutError';
  }
}

interface NativeStreamProgressWatchdogOptions {
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly onRecover: () => Promise<boolean>;
  readonly recoveryTimeoutMs?: number;
  readonly scheduler?: StreamWatchdogScheduler;
}

export class NativeStreamProgressWatchdog {
  private readonly scheduler: StreamWatchdogScheduler;
  private active = false;
  private paused = false;
  private recoveryAttempted = false;
  private generation = 0;
  private timer: unknown;
  private rejectFailure: ((error: NativeStreamIdleTimeoutError) => void) | undefined;

  constructor(private readonly options: NativeStreamProgressWatchdogOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('Native stream watchdog timeout must be a positive duration.');
    }
    if (
      options.recoveryTimeoutMs !== undefined &&
      (!Number.isFinite(options.recoveryTimeoutMs) || options.recoveryTimeoutMs <= 0)
    ) {
      throw new Error('Native stream watchdog recovery timeout must be a positive duration.');
    }
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  recordProgress(): void {
    if (!this.active || this.paused) return;
    this.arm();
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.generation += 1;
    if (this.timer !== undefined) this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this.arm();
  }

  start(): Promise<never> {
    if (this.active) throw new Error('Native stream watchdog is already active.');
    this.active = true;
    this.paused = false;
    this.recoveryAttempted = false;
    const failure = new Promise<never>((_resolve, reject) => {
      this.rejectFailure = reject;
    });
    this.arm();
    return failure;
  }

  async watch<T>(operation: Promise<T>): Promise<T> {
    const failure = this.start();
    try {
      return await Promise.race([operation, failure]);
    } finally {
      this.stop();
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.generation += 1;
    if (this.timer !== undefined) this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
    this.rejectFailure = undefined;
  }

  private arm(): void {
    if (!this.active) return;
    if (this.timer !== undefined) this.scheduler.clearTimeout(this.timer);
    const generation = ++this.generation;
    this.timer = this.scheduler.setTimeout(() => {
      void this.handleIdle(generation);
    }, this.options.timeoutMs);
  }

  private async handleIdle(generation: number): Promise<void> {
    if (!this.active || generation !== this.generation) return;
    this.timer = undefined;
    if (!this.recoveryAttempted) {
      this.recoveryAttempted = true;
      const recovered = await this.attemptRecovery();
      if (!this.active || generation !== this.generation) return;
      if (recovered) {
        this.arm();
        return;
      }
    }
    const reject = this.rejectFailure;
    this.stop();
    reject?.(new NativeStreamIdleTimeoutError(this.options.requestId, this.options.timeoutMs));
  }

  private attemptRecovery(): Promise<boolean> {
    const timeoutMs = Math.min(
      this.options.recoveryTimeoutMs ?? NATIVE_STREAM_RECOVERY_TIMEOUT_MS,
      this.options.timeoutMs,
    );
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (recovered: boolean): void => {
        if (settled) return;
        settled = true;
        this.scheduler.clearTimeout(timeout);
        resolve(recovered);
      };
      const timeout = this.scheduler.setTimeout(() => finish(false), timeoutMs);
      void this.options.onRecover().then(
        (recovered) => finish(recovered),
        () => finish(false),
      );
    });
  }
}
