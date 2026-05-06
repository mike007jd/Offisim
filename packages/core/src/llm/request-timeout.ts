export interface ScopedRequestSignal {
  readonly signal?: AbortSignal;
  cleanup(): void;
}

export function createScopedRequestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  label: string,
): ScopedRequestSignal {
  if (!(typeof timeoutMs === 'number' && timeoutMs > 0) && !signal) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    timeout = setTimeout(() => {
      controller.abort(new DOMException(`${label} timed out after ${timeoutMs}ms.`, 'TimeoutError'));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
