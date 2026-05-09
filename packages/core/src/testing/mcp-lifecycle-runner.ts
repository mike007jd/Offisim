import type { RuntimeEvent } from '@offisim/shared-types';
import { InMemoryEventBus } from '../events/event-bus.js';
import { AuditingToolExecutor } from '../mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '../mcp/mcp-tool-executor.js';
import type {
  McpClientFactory,
  McpConnection,
  McpOperationOptions,
  McpPromptDef,
  McpResourceDef,
  McpServerCapabilities,
  McpServerConfig,
  McpToolDef,
} from '../mcp/types.js';
import type {
  ToolPermissionAuthorizer,
  ToolPermissionDecision,
} from '../permissions/tool-permission-engine.js';
import { MemoryMcpAuditRepository } from '../runtime/memory-repositories.js';
import type { ToolCallRequest } from '../runtime/tool-executor.js';

export interface McpLifecycleCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly steps: readonly string[];
  readonly error?: string;
}

export interface McpLifecycleHarnessReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly McpLifecycleCaseResult[];
}

type CaseRecorder = (step: string) => void;

interface HarnessDeps {
  readonly factory: FakeMcpClientFactory;
  readonly mcpExecutor: McpToolExecutor;
  readonly auditedExecutor: AuditingToolExecutor;
  readonly auditRepo: MemoryMcpAuditRepository;
  readonly eventBus: InMemoryEventBus;
  readonly events: RuntimeEvent[];
}

export async function runMcpLifecycleHarness(): Promise<McpLifecycleHarnessReport> {
  const caseFns: ReadonlyArray<{
    readonly id: string;
    readonly run: (record: CaseRecorder) => Promise<void>;
  }> = [
    { id: 'mcp-lifecycle-success', run: runSuccessCase },
    { id: 'mcp-lifecycle-permission-denial', run: runPermissionDenialCase },
    { id: 'mcp-lifecycle-cancellation', run: runCancellationCase },
    { id: 'mcp-lifecycle-server-error', run: runServerErrorCase },
    { id: 'mcp-lifecycle-capability-change', run: runCapabilityChangeCase },
    { id: 'mcp-lifecycle-shutdown', run: runShutdownCase },
  ];

  const cases: McpLifecycleCaseResult[] = [];
  for (const caseFn of caseFns) {
    const steps: string[] = [];
    try {
      await caseFn.run((step) => steps.push(step));
      cases.push({ id: caseFn.id, passed: true, steps });
    } catch (error) {
      cases.push({
        id: caseFn.id,
        passed: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passed = cases.filter((item) => item.passed).length;
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases,
  };
}

async function runSuccessCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: allowDecision('mcp lifecycle success') });
  const connection = deps.factory.register('mcp-main', {
    tools: [tool('read_status')],
    resources: [resource('offisim://status')],
    prompts: [prompt('status-prompt')],
    capabilities: { tools: true, resources: true, prompts: true, listChanged: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-main'));
  record('initialize+capability-negotiation');

  assertEqual(deps.factory.createdServerNames, ['mcp-main'], 'server was not initialized once');
  assertEqual(connection.listToolsCount, 1, 'tool list was not requested');
  assertEqual(connection.listResourcesCount, 1, 'resource list was not requested');
  assertEqual(connection.listPromptsCount, 1, 'prompt list was not requested');
  assertCapabilities(deps.mcpExecutor.getServerCapabilities('mcp-main'), {
    tools: true,
    resources: true,
    prompts: true,
    listChanged: true,
  });
  record('tools+resources+prompts-listed');

  const response = await deps.auditedExecutor.execute(toolCall('read_status'));
  assert(response.success, `tool call failed: ${response.error ?? 'unknown error'}`);
  assertEqual(connection.callNames, ['read_status'], 'operation was not routed to MCP connection');
  record('operation-through-permission-audit-evidence-path');

  const auditRows = await deps.auditRepo.listByThread('thread-mcp');
  assertEqual(auditRows.length, 1, 'audit row was not written');
  assertEqual(auditRows[0]?.task_run_id, 'task-run-mcp', 'task-run identity was not audited');
  assertEqual(auditRows[0]?.employee_id, 'employee-mcp', 'employee identity was not audited');
  assertEqual(auditRows[0]?.server_name, 'mcp-main', 'server identity was not audited');
  assert(
    await deps.auditRepo.hasSuccessfulToolCall(
      'thread-mcp',
      'employee-mcp',
      'mcp-main',
      'read_status',
    ),
    'successful MCP evidence was not available to completion verification',
  );
  assert(
    deps.events.some((event) => event.type === 'mcp.server.connected'),
    'server connected event missing',
  );
  assert(
    deps.events.some((event) => event.type === 'mcp.tool.result'),
    'MCP result event missing',
  );
  record('audit+completion-evidence-recorded');

  await deps.mcpExecutor.dispose();
  assertEqual(connection.closeCount, 1, 'connection was not closed');
  record('shutdown');
}

async function runPermissionDenialCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: denyDecision('runtime policy denied MCP tool') });
  const connection = deps.factory.register('mcp-denied', {
    tools: [tool('write_record')],
    capabilities: { tools: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-denied'));
  record('initialize');

  const response = await deps.auditedExecutor.execute(toolCall('write_record'));
  assert(!response.success, 'denied tool call unexpectedly succeeded');
  assert(
    response.error?.includes('TOOL_PERMISSION_DENIED') === true,
    'permission denial did not return typed error',
  );
  assertEqual(connection.callNames.length, 0, 'denied tool reached MCP server');
  const auditRows = await deps.auditRepo.listByThread('thread-mcp');
  assertEqual(auditRows.length, 1, 'denied call was not audited');
  assert(auditRows[0]?.error?.includes('TOOL_PERMISSION_DENIED') === true, 'audit lacks denial');
  record('permission-denial-audited-without-side-effect');
}

async function runCancellationCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: allowDecision('cancel test') });
  deps.factory.register('mcp-cancel', {
    tools: [tool('read_slow')],
    behavior: 'wait-for-abort',
    capabilities: { tools: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-cancel'));
  record('initialize');

  const controller = new AbortController();
  const pending = deps.auditedExecutor.execute({
    ...toolCall('read_slow'),
    signal: controller.signal,
  });
  await delay(0);
  controller.abort();
  const response = await pending;

  assert(!response.success, 'cancelled tool call unexpectedly succeeded');
  assert(response.error?.includes('cancelled') === true, 'cancelled call lacks cancellation error');
  const auditRows = await deps.auditRepo.listByThread('thread-mcp');
  assertEqual(auditRows.length, 1, 'cancelled call was not audited');
  assert(auditRows[0]?.error?.includes('cancelled') === true, 'audit lacks cancellation error');
  record('in-flight-cancellation-recorded');
}

async function runServerErrorCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: allowDecision('server error test') });
  deps.factory.register('mcp-error', {
    tools: [tool('read_broken')],
    behavior: 'throw-error',
    capabilities: { tools: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-error'));
  record('initialize');

  const response = await deps.auditedExecutor.execute(toolCall('read_broken'));
  assert(!response.success, 'server error unexpectedly succeeded');
  assert(response.error?.includes('server exploded') === true, 'server error was not preserved');
  const auditRows = await deps.auditRepo.listByThread('thread-mcp');
  assertEqual(auditRows.length, 1, 'server error was not audited');
  record('server-error-classified-as-tool-error');
}

async function runCapabilityChangeCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: allowDecision('capability change test') });
  const connection = deps.factory.register('mcp-changing', {
    tools: [tool('read_old')],
    resources: [resource('offisim://old')],
    prompts: [prompt('old-prompt')],
    capabilities: { tools: true, resources: true, prompts: true, listChanged: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-changing'));
  record('initialize');

  connection.replaceCatalog({
    tools: [tool('read_new')],
    resources: [resource('offisim://new')],
    prompts: [prompt('new-prompt')],
    capabilities: { tools: true, resources: true, prompts: true, listChanged: true },
  });
  await deps.mcpExecutor.handleListChanged('mcp-changing');
  record('list-changed-refresh');

  const available = await deps.mcpExecutor.listAvailable('company-mcp');
  assert(
    available.some((item) => item.name === 'read_new') &&
      !available.some((item) => item.name === 'read_old'),
    'tool surface did not refresh after list_changed',
  );
  assertEqual(
    (await deps.mcpExecutor.listResources('mcp-changing')).map((item) => item.uri),
    ['offisim://new'],
    'resource surface did not refresh',
  );
  assertEqual(
    (await deps.mcpExecutor.listPrompts('mcp-changing')).map((item) => item.name),
    ['new-prompt'],
    'prompt surface did not refresh',
  );
  assertCapabilities(deps.mcpExecutor.getServerCapabilities('mcp-changing'), {
    tools: true,
    resources: true,
    prompts: true,
    listChanged: true,
  });
  record('updated-surface-visible');
}

async function runShutdownCase(record: CaseRecorder): Promise<void> {
  const deps = createHarnessDeps({ permission: allowDecision('shutdown test') });
  const first = deps.factory.register('mcp-first', {
    tools: [tool('read_first')],
    capabilities: { tools: true },
  });
  const second = deps.factory.register('mcp-second', {
    tools: [tool('read_second')],
    capabilities: { tools: true },
  });

  await deps.mcpExecutor.addServer(config('mcp-first'));
  await deps.mcpExecutor.addServer(config('mcp-second'));
  record('initialize-two-servers');

  await deps.mcpExecutor.dispose();
  assertEqual(first.closeCount, 1, 'first connection was not closed');
  assertEqual(second.closeCount, 1, 'second connection was not closed');
  assertEqual(deps.mcpExecutor.serverCount, 0, 'executor retained connected servers');
  assertEqual(
    await deps.mcpExecutor.listAvailable('company-mcp'),
    [],
    'tool registry was not cleared',
  );
  record('shutdown-clears-registry');
}

function createHarnessDeps(params: {
  readonly permission: ToolPermissionDecision;
}): HarnessDeps {
  const eventBus = new InMemoryEventBus();
  const events: RuntimeEvent[] = [];
  eventBus.on('', (event) => events.push(event));
  const factory = new FakeMcpClientFactory();
  const auditRepo = new MemoryMcpAuditRepository();
  const mcpExecutor = new McpToolExecutor({
    eventBus,
    companyId: 'company-mcp',
    clientFactory: factory,
  });
  const auditedExecutor = new AuditingToolExecutor(
    mcpExecutor,
    auditRepo,
    eventBus,
    'company-mcp',
    'thread-mcp',
    staticAuthorizer(params.permission),
  );

  return { factory, mcpExecutor, auditedExecutor, auditRepo, eventBus, events };
}

function staticAuthorizer(decision: ToolPermissionDecision): ToolPermissionAuthorizer {
  return {
    async evaluate() {
      return decision;
    },
  };
}

function allowDecision(reason: string): ToolPermissionDecision {
  return {
    behavior: 'allow',
    source: 'runtime',
    reason,
    approvedBy: 'harness:allow',
    policyHash: 'policy-allow',
  };
}

function denyDecision(reason: string): ToolPermissionDecision {
  return {
    behavior: 'deny',
    source: 'runtime',
    reason,
    approvedBy: 'harness:deny',
    policyHash: 'policy-deny',
  };
}

function config(name: string): McpServerConfig {
  return { name, transport: 'sse', url: `http://127.0.0.1/${name}` };
}

function tool(name: string): McpToolDef {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
  };
}

function resource(uri: string): McpResourceDef {
  return { uri, name: uri.split('/').at(-1) };
}

function prompt(name: string): McpPromptDef {
  return { name, description: `Prompt ${name}` };
}

function toolCall(name: string): ToolCallRequest {
  return {
    toolCallId: `call-${name}`,
    name,
    arguments: { value: name },
    threadId: 'thread-mcp',
    employeeId: 'employee-mcp',
    taskRunId: 'task-run-mcp',
    nodeName: 'employee',
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertCapabilities(
  actual: McpServerCapabilities | null,
  expected: McpServerCapabilities,
): void {
  assert(actual !== null, 'capabilities were not stored');
  assertEqual(actual, expected, 'capabilities mismatch');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FakeBehavior = 'success' | 'throw-error' | 'wait-for-abort';

interface FakeCatalog {
  readonly tools?: ReadonlyArray<McpToolDef>;
  readonly resources?: ReadonlyArray<McpResourceDef>;
  readonly prompts?: ReadonlyArray<McpPromptDef>;
  readonly capabilities?: McpServerCapabilities;
  readonly behavior?: FakeBehavior;
}

class FakeMcpClientFactory implements McpClientFactory {
  private readonly connections = new Map<string, FakeMcpConnection>();
  readonly createdServerNames: string[] = [];

  register(name: string, catalog: FakeCatalog): FakeMcpConnection {
    const connection = new FakeMcpConnection(config(name), catalog);
    this.connections.set(name, connection);
    return connection;
  }

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const connection = this.connections.get(config.name);
    if (!connection) {
      throw new Error(`No fake MCP connection registered for ${config.name}`);
    }
    this.createdServerNames.push(config.name);
    return connection;
  }
}

class FakeMcpConnection implements McpConnection {
  readonly config: McpServerConfig;
  tools: ReadonlyArray<McpToolDef>;
  resources: ReadonlyArray<McpResourceDef>;
  prompts: ReadonlyArray<McpPromptDef>;
  capabilities: McpServerCapabilities;
  listToolsCount = 0;
  listResourcesCount = 0;
  listPromptsCount = 0;
  closeCount = 0;
  readonly callNames: string[] = [];
  private behavior: FakeBehavior;

  constructor(config: McpServerConfig, catalog: FakeCatalog) {
    this.config = config;
    this.tools = catalog.tools ?? [];
    this.resources = catalog.resources ?? [];
    this.prompts = catalog.prompts ?? [];
    this.capabilities = catalog.capabilities ?? { tools: this.tools.length > 0 };
    this.behavior = catalog.behavior ?? 'success';
  }

  replaceCatalog(catalog: FakeCatalog): void {
    this.tools = catalog.tools ?? [];
    this.resources = catalog.resources ?? [];
    this.prompts = catalog.prompts ?? [];
    this.capabilities = catalog.capabilities ?? { tools: this.tools.length > 0 };
    this.behavior = catalog.behavior ?? this.behavior;
  }

  async listTools(): Promise<ReadonlyArray<McpToolDef>> {
    this.listToolsCount += 1;
    return this.tools;
  }

  async listResources(): Promise<ReadonlyArray<McpResourceDef>> {
    this.listResourcesCount += 1;
    return this.resources;
  }

  async listPrompts(): Promise<ReadonlyArray<McpPromptDef>> {
    this.listPromptsCount += 1;
    return this.prompts;
  }

  async callTool(
    name: string,
    _args: Record<string, unknown>,
    options?: McpOperationOptions,
  ): Promise<unknown> {
    this.callNames.push(name);
    if (this.behavior === 'throw-error') {
      throw new Error('server exploded');
    }
    if (this.behavior === 'wait-for-abort') {
      return waitForAbort(options?.signal);
    }
    return { ok: true, tool: name };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<unknown> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('MCP request aborted before start', 'AbortError'));
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('cancel test timed out'));
    }, 250);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new DOMException('MCP request aborted by harness', 'AbortError'));
      },
      { once: true },
    );
  });
}
