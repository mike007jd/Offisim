import {
  createRuntimeHarness,
  parseArgs,
  resolveCommonOptions,
  runGatewayRequest,
  runRuntimeRequest,
} from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const options = resolveCommonOptions(args);
const level = (args.level || process.env.HARNESS_LEVEL || 'gateway').trim();

if (level !== 'gateway' && level !== 'runtime') {
  throw new Error(`Unsupported --level "${level}". Use gateway or runtime.`);
}

if (level === 'gateway') {
  const result = await runGatewayRequest(options);
  console.log(
    JSON.stringify(
      {
        level,
        provider: options.provider,
        executionLane: options.executionLane,
        model: options.model,
        baseURL: options.baseUrl ?? null,
        stream: options.stream,
        ...result,
      },
      null,
      2,
    ),
  );
  process.exit(result.ok ? 0 : 1);
}

const runtime = await createRuntimeHarness(options);
const result = await runRuntimeRequest(options, runtime);
runtime.dispose();

console.log(
  JSON.stringify(
    {
      level,
      provider: options.provider,
      executionLane: options.executionLane,
      model: options.model,
      baseURL: options.baseUrl ?? null,
      entryMode: 'direct_chat',
      employee: {
        id: runtime.employeeId,
        name: runtime.employeeName,
        role: runtime.employeeRole,
      },
      ...result,
    },
    null,
    2,
  ),
);
process.exit(result.ok ? 0 : 1);
