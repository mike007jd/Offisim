import { describe, expect, it } from 'vitest';
import { buildEnrichedEmployeeList } from '../../agents/employee-roster.js';
import { makeEmployee } from '../helpers/fixtures.js';

describe('buildEnrichedEmployeeList', () => {
  it('gracefully degrades when persona_json and config_json are empty or invalid', () => {
    const roster = buildEnrichedEmployeeList([
      makeEmployee({
        employee_id: 'e-null',
        name: 'Null Bot',
        persona_json: null,
        config_json: null,
      }),
      makeEmployee({
        employee_id: 'e-invalid',
        name: 'Broken Bot',
        persona_json: '{',
        config_json: '{',
      }),
      makeEmployee({
        employee_id: 'e-empty',
        name: 'Empty Bot',
        persona_json: '{}',
        config_json: '{}',
      }),
    ]);

    expect(roster).toContain('- e-null: Null Bot (developer)');
    expect(roster).toContain('- e-invalid: Broken Bot (developer)');
    expect(roster).toContain('- e-empty: Empty Bot (developer)');
    expect(roster).not.toContain('expertise:');
    expect(roster).not.toContain('skill:');
  });

  it('includes expertise and installed skill details when present', () => {
    const roster = buildEnrichedEmployeeList([
      makeEmployee({
        employee_id: 'e-skill',
        name: 'Skill Bot',
        persona_json: JSON.stringify({ expertise: 'Animation pipelines' }),
        config_json: JSON.stringify({
          runtimeSkill: {
            skillName: 'Sprite Pipeline',
            summary: 'Normalize and validate sprite sheets',
          },
        }),
      }),
    ]);

    expect(roster).toContain('expertise: Animation pipelines');
    expect(roster).toContain('skill: Sprite Pipeline (Normalize and validate sprite sheets)');
  });
});
