import { describe, expect, it } from 'vitest';
import {
  buildConfigJson,
  buildPersonaJson,
  parseConfigJson,
  parsePersonaJson,
} from '../../hooks/useEmployeeEditor';

describe('useEmployeeEditor config helpers', () => {
  it('parses runtime skill and tool permission policy from config_json', () => {
    const parsed = parseConfigJson(
      JSON.stringify({
        modelPreference: 'gpt-4o',
        temperature: 0.4,
        maxTokens: 2048,
        runtimeSkill: {
          skillName: 'calendar-skill',
          summary: 'Manages calendar operations',
          instructionMode: 'full',
          capabilityIndex: {
            capabilities: [{ key: 'create_event', label: 'Create Event' }],
          },
        },
        toolPermissionPolicy: {
          defaultMode: 'ask_first_time',
          overrides: [{ pattern: 'calendar.*', mode: 'auto' }],
        },
      }),
    );

    expect(parsed.modelPreference).toBe('gpt-4o');
    expect(parsed.skillEnabled).toBe(true);
    expect(parsed.runtimeSkill?.skillName).toBe('calendar-skill');
    expect(parsed.toolPermissionPolicy).toEqual({
      defaultMode: 'ask_first_time',
      overrides: [{ pattern: 'calendar.*', mode: 'auto' }],
    });
  });

  it('serializes disabled skills and tool permission policy back into config_json', () => {
    const raw = buildConfigJson({
      modelPreference: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 1024,
      skillEnabled: false,
      runtimeSkill: {
        skillName: 'calendar-skill',
        summary: 'Manages calendar operations',
      },
      toolPermissionPolicy: {
        defaultMode: 'always_ask',
        overrides: [{ pattern: 'fs.*', mode: 'ask_first_time' }],
      },
    });

    expect(JSON.parse(raw)).toEqual({
      modelPreference: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 1024,
      runtimeSkill: {
        skillName: 'calendar-skill',
        summary: 'Manages calendar operations',
        enabled: false,
      },
      toolPermissionPolicy: {
        defaultMode: 'always_ask',
        overrides: [{ pattern: 'fs.*', mode: 'ask_first_time' }],
      },
    });
  });
});

describe('useEmployeeEditor persona helpers', () => {
  it('round-trips advanced persona dimensions', () => {
    const raw = buildPersonaJson({
      expertise: 'Frontend systems',
      style: 'direct',
      customInstructions: 'Prefer short updates.',
      communicationFrequency: 'high',
      riskPreference: 'balanced',
      decisionStyle: 'analytical',
      appearance: {
        skinColor: 0xfdbcb4,
        hairColor: 0x1a1a1a,
        hairStyle: 'short',
        clothingColor: 0x4a90d9,
        clothingAccent: 0xffffff,
        bodyType: 'normal',
        gender: 'neutral',
      },
    });

    expect(parsePersonaJson(raw)).toMatchObject({
      expertise: 'Frontend systems',
      style: 'direct',
      customInstructions: 'Prefer short updates.',
      communicationFrequency: 'high',
      riskPreference: 'balanced',
      decisionStyle: 'analytical',
    });
  });
});
