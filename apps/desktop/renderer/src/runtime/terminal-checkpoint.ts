const TERMINAL_CHECKPOINT_RETRY_MS = 5_000;
export const TERMINAL_CHECKPOINT_MAX_RETRIES = 3;

export class AgentTerminalCheckpointError extends Error {
  readonly runId: string;

  constructor(runId: string, cause: unknown) {
    super('The run finished, but its durable terminal checkpoint could not be committed.', {
      cause,
    });
    this.name = 'AgentTerminalCheckpointError';
    this.runId = runId;
  }
}

export async function waitForTerminalCheckpointRetry(
  signals: readonly AbortSignal[],
): Promise<void> {
  if (signals.some((signal) => signal.aborted)) {
    throw new Error('Terminal checkpoint retry was cancelled.');
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      for (const signal of signals) signal.removeEventListener('abort', cancel);
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, TERMINAL_CHECKPOINT_RETRY_MS);
    const cancel = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Terminal checkpoint retry was cancelled.'));
    };
    for (const signal of signals) signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function retryTerminalCheckpointUntilDurable({
  label,
  runId,
  commit,
  initialError,
  signals = [],
}: {
  label: string;
  runId: string;
  commit: () => Promise<void>;
  initialError: unknown;
  signals?: readonly AbortSignal[];
}): Promise<void> {
  let persistenceError = initialError;
  for (let attempt = 1; attempt <= TERMINAL_CHECKPOINT_MAX_RETRIES; attempt += 1) {
    console.warn('[desktop-agent-runtime] terminal checkpoint retrying', {
      label,
      runId,
      attempt,
      persistenceError,
    });
    try {
      await waitForTerminalCheckpointRetry(signals);
    } catch (cause) {
      throw new AgentTerminalCheckpointError(runId, cause);
    }
    try {
      await commit();
      return;
    } catch (error) {
      persistenceError = error;
    }
  }
  throw new AgentTerminalCheckpointError(runId, persistenceError);
}
