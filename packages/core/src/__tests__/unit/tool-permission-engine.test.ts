import type { RuntimePolicyConfig } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { ToolPermissionEngine } from '../../permissions/tool-permission-engine.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type { EmployeeRow, NewMcpAudit } from '../../runtime/repositories.js';

function makeEmployee(
  overrides: Partial<EmployeeRow> & Pick<EmployeeRow, 'employee_id' | 'company_id'>,
): EmployeeRow {
  return {
    employee_id: overrides.employee_id,
    company_id: overrides.company_id,
    source_asset_id: null,
    source_package_id: null,
    name: overrides.name ?? 'Employee',
    role_slug: overrides.role_slug ?? 'developer',
    workstation_id: overrides.workstation_id ?? null,
    persona_json: overrides.persona_json ?? null,
    config_json: overrides.config_json ?? null,
    enabled: overrides.enabled ?? 1,
    created_at: overrides.created_at ?? '2026-04-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-01T00:00:00.000Z',
  };
}

function makeRuntimePolicy(
  overrides?: Partial<RuntimePolicyConfig['toolPermissions']>,
): RuntimePolicyConfig {
  return {
    executionMode: 'desktop-trusted',
    modelPolicy: {
      default: {
        profileName: 'default',
        provider: 'subscription',
        model: 'gpt-4.1-mini',
      },
    },
    summarization: {
      enabled: true,
      triggerTokens: 60_000,
      keepRecentMessages: 30,
    },
    memory: {
      enabled: true,
      injectionEnabled: true,
      maxFacts: 50,
      factConfidenceThreshold: 0.7,
    },
    toolSearch: {
      enabled: true,
    },
    toolPermissions: {
      enabled: true,
      defaultBehavior: 'allow',
      rules: [],
      ...overrides,
    },
  };
}

async function seedApprovedAudit(
  repos: ReturnType<typeof createMemoryRepositories>,
  overrides?: Partial<NewMcpAudit>,
): Promise<void> {
  await repos.mcpAudit.create({
    audit_id: overrides?.audit_id ?? 'ma-1',
    thread_id: overrides?.thread_id ?? 'thread-1',
    task_run_id: overrides?.task_run_id ?? null,
    employee_id: overrides?.employee_id ?? 'emp-1',
    server_name: overrides?.server_name ?? 'fs-server',
    tool_name: overrides?.tool_name ?? 'read_file',
    arguments_json: overrides?.arguments_json ?? '{}',
    result_json: overrides?.result_json ?? '{"ok":true}',
    error: overrides?.error ?? null,
    latency_ms: overrides?.latency_ms ?? 10,
    approved_by: overrides?.approved_by ?? 'employee:auto',
    created_at: overrides?.created_at ?? '2026-04-01T00:00:00.000Z',
  });
}

describe('ToolPermissionEngine', () => {
  it('allows tool calls when no runtime or employee policy applies', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([makeEmployee({ employee_id: 'emp-1', company_id: 'company-1' })]);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'allow',
      source: 'default',
      approvedBy: 'auto',
    });
  });

  it('denies when runtime policy has a matching deny rule', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([makeEmployee({ employee_id: 'emp-1', company_id: 'company-1' })]);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
      runtimePolicy: makeRuntimePolicy({
        rules: [{ pattern: 'mcp:fs-server:read_*', behavior: 'deny' }],
      }),
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'deny',
      source: 'runtime',
      approvedBy: 'runtime:deny',
      matchedPattern: 'mcp:fs-server:read_*',
    });
  });

  it('asks on first use when employee policy is ask_first_time', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([
      makeEmployee({
        employee_id: 'emp-1',
        company_id: 'company-1',
        config_json: JSON.stringify({
          toolPermissionPolicy: {
            defaultMode: 'ask_first_time',
            overrides: [],
          },
        }),
      }),
    ]);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'ask',
      source: 'employee',
      approvedBy: 'employee:ask_first_time',
    });
  });

  it('allows ask_first_time after a successful prior audit for the same employee and tool', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([
      makeEmployee({
        employee_id: 'emp-1',
        company_id: 'company-1',
        config_json: JSON.stringify({
          toolPermissionPolicy: {
            defaultMode: 'ask_first_time',
            overrides: [],
          },
        }),
      }),
    ]);
    await seedApprovedAudit(repos);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'allow',
      source: 'employee',
      approvedBy: 'employee:ask_first_time:cached',
    });
  });

  it('respects employee override specificity over the employee default mode', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([
      makeEmployee({
        employee_id: 'emp-1',
        company_id: 'company-1',
        config_json: JSON.stringify({
          toolPermissionPolicy: {
            defaultMode: 'always_ask',
            overrides: [{ pattern: 'read_*', mode: 'auto' }],
          },
        }),
      }),
    ]);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'allow',
      source: 'employee',
      approvedBy: 'employee:auto',
      matchedPattern: 'read_*',
    });
  });

  it('treats runtime ask as stricter than employee auto', async () => {
    const repos = createMemoryRepositories();
    repos.seed.employees([
      makeEmployee({
        employee_id: 'emp-1',
        company_id: 'company-1',
        config_json: JSON.stringify({
          toolPermissionPolicy: {
            defaultMode: 'auto',
            overrides: [],
          },
        }),
      }),
    ]);

    const engine = new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
      runtimePolicy: makeRuntimePolicy({
        rules: [{ pattern: 'mcp:fs-server:*', behavior: 'ask' }],
      }),
    });

    const decision = await engine.evaluate({
      threadId: 'thread-1',
      serverName: 'fs-server',
      toolName: 'read_file',
      employeeId: 'emp-1',
    });

    expect(decision).toMatchObject({
      behavior: 'ask',
      source: 'runtime',
      approvedBy: 'runtime:ask',
    });
  });
});
