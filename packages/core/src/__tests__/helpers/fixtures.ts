import { ModelResolver } from '../../llm/model-resolver.js';
import type { CompanyRow, EmployeeRow } from '../../runtime/repositories.js';

export const TEST_COMPANY_ID = 'c-test-1';
export const TEST_THREAD_ID = 't-test-1';

export const TEST_COMPANY = {
  company_id: TEST_COMPANY_ID,
  name: 'Test Corp',
  status: 'active',
  workspace_root: null,
  default_model_policy_json: JSON.stringify({
    default: {
      profileName: 'test',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
    },
  }),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} satisfies CompanyRow;

export function createTestModelResolver(): ModelResolver {
  const policyJson = TEST_COMPANY.default_model_policy_json;
  if (!policyJson) {
    throw new Error('TEST_COMPANY.default_model_policy_json is required for tests');
  }
  return new ModelResolver(JSON.parse(policyJson));
}

export function assertDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined');
  }
  return value;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for smoke tests`);
  }
  return value;
}

export function makeEmployee(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return {
    employee_id: 'e-dev-1',
    company_id: TEST_COMPANY_ID,
    source_asset_id: null,
    source_package_id: null,
    name: 'Dev Bot',
    role_slug: 'developer',
    workstation_id: null,
    persona_json: JSON.stringify({ expertise: 'TypeScript', tone: 'concise' }),
    config_json: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeManager(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return makeEmployee({
    employee_id: 'e-mgr-1',
    name: 'Manager Bot',
    role_slug: 'manager',
    persona_json: JSON.stringify({ expertise: 'project management' }),
    ...overrides,
  });
}
