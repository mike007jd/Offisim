export interface RuntimeHealthSample {
  readonly timestampMs: number;
  readonly heapUsedMb: number;
  readonly rssMb: number;
}

export interface LatencySummary {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function sampleRuntimeHealth(nowMs = Date.now()): RuntimeHealthSample {
  const memory = process.memoryUsage();
  return {
    timestampMs: nowMs,
    heapUsedMb: bytesToMb(memory.heapUsed),
    rssMb: bytesToMb(memory.rss),
  };
}

export function summarizeLatencyMs(values: readonly number[]): LatencySummary {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

export function heapGrowthMbPerHour(start: RuntimeHealthSample, end: RuntimeHealthSample): number {
  const elapsedHours = Math.max((end.timestampMs - start.timestampMs) / 3_600_000, 1 / 60);
  return round((end.heapUsedMb - start.heapUsedMb) / elapsedHours);
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[index] ?? 0);
}

function bytesToMb(bytes: number): number {
  return round(bytes / 1024 / 1024);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
