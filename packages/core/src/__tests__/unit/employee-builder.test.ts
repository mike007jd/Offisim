import { describe, expect, it } from 'vitest';
import { buildEmployeePrompt } from '../../agents/employee-builder.js';
import type { CompanyRow, EmployeeRow } from '../../runtime/repositories.js';

const COMPANY: CompanyRow = {
  company_id: 'c-1',
  name: 'Acme AI',
  status: 'active',
  workspace_root: null,
  default_model_policy_json: JSON.stringify({
    default: {
      profileName: 'balanced',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
    },
  }),
  created_at: '',
  updated_at: '',
};

function makeEmployee(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return {
    employee_id: 'e-1',
    company_id: 'c-1',
    source_asset_id: null,
    source_package_id: null,
    name: 'Dev Bot',
    role_slug: 'developer',
    workstation_id: null,
    persona_json: null,
    config_json: null,
    enabled: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('buildEmployeePrompt', () => {
  it('builds basic prompt from role and company', () => {
    const prompt = buildEmployeePrompt(makeEmployee(), COMPANY, 'Write tests');
    expect(prompt).toContain('Dev Bot');
    expect(prompt).toContain('developer');
    expect(prompt).toContain('Acme AI');
    expect(prompt).toContain('Write tests');
  });

  it('includes persona when valid JSON', () => {
    const emp = makeEmployee({
      persona_json: JSON.stringify({ expertise: 'TypeScript', tone: 'concise' }),
    });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('concise');
  });

  it('degrades gracefully on invalid persona JSON', () => {
    const emp = makeEmployee({ persona_json: 'not json' });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    expect(prompt).toContain('Dev Bot');
  });

  it('degrades gracefully on null persona', () => {
    const emp = makeEmployee({ persona_json: null });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    expect(prompt).toContain('Dev Bot');
  });
});
