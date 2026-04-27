export interface ToolBatchOrchestratorOptions<TCall, TResult> {
  readonly calls: readonly TCall[];
  readonly isConcurrencySafe: (call: TCall) => boolean;
  readonly execute: (call: TCall) => Promise<TResult>;
}

interface ToolCallBatch<TCall> {
  readonly concurrencySafe: boolean;
  readonly calls: readonly TCall[];
  readonly startIndex: number;
}

export async function runToolCallsInBatches<TCall, TResult>(
  options: ToolBatchOrchestratorOptions<TCall, TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
  const batches = partitionToolCalls(options.calls, options.isConcurrencySafe);
  const settled: PromiseSettledResult<TResult>[] = new Array(options.calls.length);

  for (const batch of batches) {
    if (batch.concurrencySafe) {
      const results = await Promise.allSettled(batch.calls.map((call) => options.execute(call)));
      for (let offset = 0; offset < results.length; offset += 1) {
        settled[batch.startIndex + offset] = results[offset] as PromiseSettledResult<TResult>;
      }
      continue;
    }

    for (let offset = 0; offset < batch.calls.length; offset += 1) {
      const call = batch.calls[offset] as TCall;
      try {
        settled[batch.startIndex + offset] = {
          status: 'fulfilled',
          value: await options.execute(call),
        };
      } catch (reason) {
        settled[batch.startIndex + offset] = { status: 'rejected', reason };
      }
    }
  }

  return settled;
}

function partitionToolCalls<TCall>(
  calls: readonly TCall[],
  isConcurrencySafe: (call: TCall) => boolean,
): ToolCallBatch<TCall>[] {
  const batches: ToolCallBatch<TCall>[] = [];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index] as TCall;
    const safe = isConcurrencySafe(call);
    const last = batches.at(-1);
    if (safe && last?.concurrencySafe) {
      batches[batches.length - 1] = {
        ...last,
        calls: [...last.calls, call],
      };
      continue;
    }
    batches.push({ concurrencySafe: safe, calls: [call], startIndex: index });
  }
  return batches;
}
