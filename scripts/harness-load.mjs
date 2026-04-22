import {
  buildMessageCase,
  createGatewayHarness,
  createRuntimeHarness,
  parseArgs,
  resolveCommonOptions,
  runGatewayRequest,
  runRuntimeRequest,
  runWithConcurrency,
  summarizeResults,
} from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const options = resolveCommonOptions(args);
const level = (args.level || process.env.HARNESS_LEVEL || 'gateway').trim();
const scenario = (args.scenario || process.env.HARNESS_SCENARIO || 'shared').trim();
const iterations = Number.parseInt(
  String(args.iterations || process.env.HARNESS_ITERATIONS || '4'),
  10,
);
const concurrency = Number.parseInt(
  String(args.concurrency || process.env.HARNESS_CONCURRENCY || '2'),
  10,
);
const messageCase = (args['message-case'] || process.env.HARNESS_MESSAGE_CASE || 'short').trim();

if (level !== 'gateway' && level !== 'runtime') {
  throw new Error(`Unsupported --level "${level}". Use gateway or runtime.`);
}
if (scenario !== 'shared' && scenario !== 'isolated') {
  throw new Error(`Unsupported --scenario "${scenario}". Use shared or isolated.`);
}
if (!Number.isFinite(iterations) || iterations <= 0) {
  throw new Error(`Invalid --iterations "${iterations}".`);
}
if (!Number.isFinite(concurrency) || concurrency <= 0) {
  throw new Error(`Invalid --concurrency "${concurrency}".`);
}

const runOptionsFor = (index) => ({
  ...options,
  message: buildMessageCase(messageCase, options.message, index),
});

let sharedGateway = null;
let sharedRuntime = null;

if (scenario === 'shared' && level === 'gateway') {
  sharedGateway = await createGatewayHarness(options);
}
if (scenario === 'shared' && level === 'runtime') {
  sharedRuntime = await createRuntimeHarness(options);
}

const tasks = Array.from({ length: iterations }, (_, index) => async () => {
  const taskOptions = runOptionsFor(index);
  if (level === 'gateway') {
    return runGatewayRequest(taskOptions, sharedGateway ?? undefined);
  }
  return runRuntimeRequest(taskOptions, sharedRuntime ?? undefined);
});

const results = await runWithConcurrency(tasks, concurrency);
sharedGateway?.dispose();
sharedRuntime?.dispose();

console.log(
  JSON.stringify(
    {
      level,
      scenario,
      provider: options.provider,
      executionLane: options.executionLane,
      model: options.model,
      baseURL: options.baseUrl ?? null,
      concurrency,
      iterations,
      messageCase,
      summary: summarizeResults(results),
      samples: results.slice(0, Math.min(results.length, 10)),
    },
    null,
    2,
  ),
);
process.exit(results.every((result) => result.ok) ? 0 : 1);
