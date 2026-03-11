/**
 * Integration test: MCP tool flow through employee node.
 *
 * Tests the full cycle:
 * 1. Employee calls LLM -> LLM requests tool
 * 2. McpToolExecutor dispatches to mock MCP server -> result returned
 * 3. Employee does follow-up LLM call with results -> produces final answer
 * 4. Events: mcpToolCalled emitted during tool execution
 */

import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { employeeNode } from '../../agents/employee-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { McpToolExecutor } from '../../mcp/mcp-tool-executor.js';
import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '../../mcp/types.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  makeEmployee,
  makeManager,
} from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

// ── Mock MCP Client Factory ──────────────────────────────────────

class TestMcpClientFactory implements McpClientFactory {
  private readonly serverTools = new Map<string, McpToolDef[]>();
  private readonly toolHandlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  /** Register a mock MCP server with its tools and handlers. */
  register(
    serverName: string,
    tools: McpToolDef[],
    handlers: Record<string, (args: Record<string, unknown>) => unknown>,
  ): void {
    this.serverTools.set(serverName, tools);
    for (const [name, handler] of Object.entries(handlers)) {
      this.toolHandlers.set(`${serverName}:${name}`, handler);
    }
  }

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const tools = this.serverTools.get(config.name) ?? [];
    const self = this;

    return {
      config,
      tools,
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const handler = self.toolHandlers.get(`${config.name}:${name}`);
        if (!handler) {
          throw new Error(`No handler for tool '${name}' on server '${config.name}'`);
        }
        return handler(args);
      },
      async close(): Promise<void> {
        /* noop */
      },
    };
  }
}

// ── Test helpers ─────────────────────────────────────────────────

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Analyze the codebase')],
    routeDecision: 'delegate_manager',
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [
      {
        taskType: 'code',
        employeeId: 'e-dev-1',
        inputJson: {
          description: 'Analyze the codebase and suggest improvements',
          taskRunId: 'tr-mcp-1',
        },
      },
    ],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: null,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('MCP tool flow integration', () => {
  let gateway: MockLlmGateway;
  let mcpExecutor: McpToolExecutor;
  let eventBus: InMemoryEventBus;
  let config: RunnableConfig;
  let repos: ReturnType<typeof createMemoryRepositories>;
  // biome-ignore lint/suspicious/noExplicitAny: event collector captures all payload types
  let events: RuntimeEvent<any>[];

  beforeEach(async () => {
    gateway = new MockLlmGateway();
    eventBus = new InMemoryEventBus();
    events = [];
    eventBus.on('', (e) => events.push(e));

    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    // Set up mock MCP server
    const mcpFactory = new TestMcpClientFactory();
    mcpFactory.register(
      'code-server',
      [
        {
          name: 'readFile',
          description: 'Read a file from the workspace',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
        {
          name: 'searchCode',
          description: 'Search for patterns in code',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      {
        readFile: (args) => ({
          content: `// File: ${args.path}\nexport function main() { console.log("hello"); }`,
        }),
        searchCode: (args) => ({
          matches: [
            { file: 'src/index.ts', line: 1, text: `match for "${args.query}"` },
            { file: 'src/utils.ts', line: 5, text: `another match for "${args.query}"` },
          ],
        }),
      },
    );

    mcpExecutor = new McpToolExecutor({
      eventBus,
      companyId: TEST_COMPANY_ID,
      clientFactory: mcpFactory,
    });

    // Connect the mock MCP server
    await mcpExecutor.addServer({ name: 'code-server', transport: 'stdio', command: 'mock' });

    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor: mcpExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    config = { configurable: { runtimeCtx } };

    // Seed a task run
    await repos.taskRuns.create({
      task_run_id: 'tr-mcp-1',
      thread_id: TEST_THREAD_ID,
      employee_id: 'e-dev-1',
      parent_task_run_id: null,
      task_type: 'code',
      status: 'pending',
      input_json: JSON.stringify({ description: 'Analyze the codebase and suggest improvements' }),
      output_json: null,
      started_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await mcpExecutor.dispose();
  });

  it('employee calls LLM -> tool call -> MCP dispatch -> follow-up -> final answer', async () => {
    // Round 1: LLM requests readFile tool
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-read-1',
          name: 'readFile',
          arguments: { path: 'src/index.ts' },
        },
      ],
    });

    // Round 2: LLM produces final response after seeing tool results
    gateway.pushResponse({
      content:
        'After reading src/index.ts, I found a simple main function. I suggest adding error handling and type safety.',
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Verify final output
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toContain('error handling and type safety');
    expect(result.currentEmployeeId).toBe('e-dev-1');

    // Verify task completed
    const taskRun = await repos.taskRuns.findById('tr-mcp-1');
    expect(taskRun?.status).toBe('completed');

    // Verify mcpToolCalled event was emitted
    const mcpToolEvents = events.filter((e) => e.type === 'mcp.tool.called');
    expect(mcpToolEvents).toHaveLength(1);
    expect(mcpToolEvents[0]?.payload.serverName).toBe('code-server');
    expect(mcpToolEvents[0]?.payload.toolName).toBe('readFile');

    // Verify LLM was called twice (initial + follow-up)
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.filter((c) => c.node_name === 'employee')).toHaveLength(2);
  });

  it('multi-round MCP tool calls with different tools', async () => {
    // Round 1: LLM requests readFile
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-read-1',
          name: 'readFile',
          arguments: { path: 'src/index.ts' },
        },
      ],
    });

    // Round 2: LLM requests searchCode based on file contents
    gateway.pushResponse({
      content: '',
      toolCalls: [
        {
          id: 'tc-search-1',
          name: 'searchCode',
          arguments: { query: 'export function' },
        },
      ],
    });

    // Round 3: LLM produces final response
    gateway.pushResponse({
      content:
        'I found 2 exported functions across 2 files. The codebase is well-structured but could benefit from documentation.',
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Verify final output
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toContain('2 exported functions');

    // Verify mcpToolCalled events for both tools
    const mcpToolEvents = events.filter((e) => e.type === 'mcp.tool.called');
    expect(mcpToolEvents).toHaveLength(2);
    expect(mcpToolEvents[0]?.payload.toolName).toBe('readFile');
    expect(mcpToolEvents[1]?.payload.toolName).toBe('searchCode');

    // 3 LLM calls total
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.filter((c) => c.node_name === 'employee')).toHaveLength(3);
  });

  it('handles MCP tool error gracefully and continues', async () => {
    // Replace the mock MCP server with one that has a failing tool
    await mcpExecutor.dispose();

    const errorFactory = new TestMcpClientFactory();
    errorFactory.register(
      'buggy-server',
      [
        {
          name: 'crashingTool',
          description: 'Always crashes',
          inputSchema: {},
        },
      ],
      {
        crashingTool: () => {
          throw new Error('Server crashed!');
        },
      },
    );

    // Create new executor with the buggy server
    mcpExecutor = new McpToolExecutor({
      eventBus,
      companyId: TEST_COMPANY_ID,
      clientFactory: errorFactory,
    });
    await mcpExecutor.addServer({ name: 'buggy-server', transport: 'stdio', command: 'mock' });

    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor: mcpExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });
    config = { configurable: { runtimeCtx } };

    // LLM requests the crashing tool
    gateway.pushResponse({
      content: '',
      toolCalls: [{ id: 'tc-crash', name: 'crashingTool', arguments: {} }],
    });

    // Follow-up with error info — LLM should still produce a response
    gateway.pushResponse({
      content: 'The tool crashed, but I can still provide a general answer based on my knowledge.',
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    // Employee should still produce output despite tool error
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toContain('general answer');
  });

  it('mcpServerConnected event emitted during setup', () => {
    // The mcpServerConnected event should have been emitted in beforeEach
    const serverEvents = events.filter((e) => e.type === 'mcp.server.connected');
    expect(serverEvents).toHaveLength(1);
    expect(serverEvents[0]?.payload).toEqual({
      serverName: 'code-server',
      toolCount: 2,
    });
  });

  it('employee with no tool calls skips MCP entirely', async () => {
    // LLM responds directly without tool calls
    gateway.pushResponse({
      content: 'I can provide my analysis without using any tools.',
    });

    const state = makeState();
    const result = await employeeNode(state, config);

    expect(result.messages).toHaveLength(1);

    // No mcpToolCalled events
    const mcpToolEvents = events.filter((e) => e.type === 'mcp.tool.called');
    expect(mcpToolEvents).toHaveLength(0);

    // Only 1 LLM call (no follow-up needed)
    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    expect(llmCalls.filter((c) => c.node_name === 'employee')).toHaveLength(1);
  });
});
