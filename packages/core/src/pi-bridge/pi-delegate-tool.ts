/**
 * The `delegate` virtual tool — agent-as-tool delegation.
 *
 * The boss is a pi agent; "assign work to an employee" is one tool call. There
 * is no static dispatch graph. For a LOCAL employee the tool spins up a sub-agent
 * (an employee pi loop) via the orchestration's `runLocalEmployee`; for an
 * EXTERNAL (A2A) employee it carries over the old `employeeA2aExecutor` path —
 * build the peer from the employee row, `sendAndWait`, extract the reply.
 *
 * Parallel executionMode lets the boss delegate to several employees at once;
 * each sub-agent registers under the same thread so whole-team abort reaches it.
 */

import type { AgentTool, AgentToolResult } from '@offisim/pi-agent';
import type { TSchema } from '@offisim/pi-ai';
import type { A2APeer, A2ATask } from '../a2a/a2a-types.js';
import { A2AClient } from '../a2a/index.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';
import type { PiToolContext } from './pi-tool-adapter.js';

const logger = new Logger('pi-delegate-tool');

const DELEGATE_PARAMS = {
  type: 'object',
  properties: {
    employee_id: {
      type: 'string',
      description: 'The id of the employee to assign this task to (from the roster).',
    },
    task: {
      type: 'string',
      description: 'A clear, self-contained description of the task for the employee.',
    },
  },
  required: ['employee_id', 'task'],
  additionalProperties: false,
} as const;

interface DelegateArgs {
  employee_id: string;
  task: string;
}

export interface DelegateToolDeps {
  readonly runtimeCtx: RuntimeContext;
  readonly toolCtx: PiToolContext;
  /**
   * Run a LOCAL employee (already resolved from the roster) as a sub-agent and
   * resolve to its final reply text. Supplied by the orchestration (it recurses
   * into `runWorker`); passing the resolved row avoids a second `findById`. The
   * signal is the boss's tool-call abort signal, so cancelling the boss cancels
   * the child.
   */
  readonly runLocalEmployee: (
    employee: EmployeeRow,
    task: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export function createDelegateTool(deps: DelegateToolDeps): AgentTool {
  const { runtimeCtx, runLocalEmployee } = deps;
  return {
    name: 'delegate',
    label: 'Delegate to employee',
    description:
      'Assign a task to one of your employees by id (see the roster in your ' +
      'instructions). The employee does the work with its own tools and returns ' +
      'the result. Delegate to multiple employees in one turn to parallelize.',
    parameters: DELEGATE_PARAMS as unknown as TSchema,
    executionMode: 'parallel',
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> => {
      const args = (params ?? {}) as DelegateArgs;
      if (!args.employee_id?.trim() || !args.task?.trim()) {
        throw new Error('delegate requires employee_id and task');
      }
      const employee = await runtimeCtx.repos.employees.findById(args.employee_id);
      if (!employee) {
        throw new Error(`No employee with id ${args.employee_id}`);
      }
      if (employee.enabled !== 1) {
        throw new Error(`Employee ${employee.name} is disabled and cannot take work`);
      }

      if (employee.is_external === 1) {
        const text = await dispatchExternalA2A(employee, args.task, signal);
        return {
          content: [{ type: 'text', text }],
          details: { employeeId: employee.employee_id, external: true },
        };
      }

      const text = await runLocalEmployee(employee, args.task, signal);
      return {
        content: [{ type: 'text', text }],
        details: { employeeId: employee.employee_id, external: false },
      };
    },
  };
}

async function dispatchExternalA2A(
  employee: EmployeeRow,
  task: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = employee.a2a_url?.trim();
  if (!url) {
    throw new Error(`External employee ${employee.name} has no A2A url configured`);
  }
  const peer: A2APeer = {
    name: employee.name,
    url,
    ...(employee.a2a_token ? { token: employee.a2a_token } : {}),
    ...(employee.a2a_agent_id ? { agentId: employee.a2a_agent_id } : {}),
  };
  logger.info('delegating to external A2A employee', {
    employeeId: employee.employee_id,
    peer: peer.name,
  });
  const client = new A2AClient(peer);
  const result = await client.sendAndWait(task, { ...(signal ? { signal } : {}) });
  return extractA2AText(result);
}

function extractA2AText(task: A2ATask): string {
  const texts: string[] = [];
  for (const part of task.status.message?.parts ?? []) {
    if (typeof part.text === 'string' && part.text.trim()) texts.push(part.text);
  }
  for (const artifact of task.artifacts ?? []) {
    for (const part of artifact.parts) {
      if (typeof part.text === 'string' && part.text.trim()) texts.push(part.text);
    }
  }
  return texts.join('\n').trim() || `External employee completed (state: ${task.status.state}).`;
}
