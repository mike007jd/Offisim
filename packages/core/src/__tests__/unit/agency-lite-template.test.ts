import { describe, expect, it } from 'vitest';
import { agencyLiteTemplate } from '../../templates/agency-lite.js';
import { getTemplate, listTemplates } from '../../templates/index.js';

describe('Agency Lite template', () => {
  it('is registered in the template list', () => {
    const templates = listTemplates();
    const found = templates.find((t) => t.id === 'agency-lite');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Agency Lite');
  });

  it('can be retrieved by id', () => {
    const template = getTemplate('agency-lite');
    expect(template).toBeDefined();
    expect(template!.id).toBe('agency-lite');
  });

  it('has 5 employees', () => {
    expect(agencyLiteTemplate.employees).toHaveLength(5);
  });

  it('all employees have valid persona_json with characterConfig', () => {
    for (const emp of agencyLiteTemplate.employees) {
      const persona = JSON.parse(emp.persona_json);
      expect(persona.expertise).toBeTruthy();
      expect(persona.style).toBeTruthy();
      expect(persona.characterConfig).toBeDefined();
      expect(typeof persona.characterConfig.skinColor).toBe('number');
      expect(typeof persona.characterConfig.hairColor).toBe('number');
      expect(typeof persona.characterConfig.clothingColor).toBe('number');
      expect(persona.characterConfig.hairStyle).toBeTruthy();
      expect(persona.characterConfig.bodyType).toBeTruthy();
      expect(persona.characterConfig.gender).toBeTruthy();
    }
  });

  it('all employees have valid config_json', () => {
    for (const emp of agencyLiteTemplate.employees) {
      const config = JSON.parse(emp.config_json);
      expect(typeof config.temperature).toBe('number');
      expect(config.temperature).toBeGreaterThanOrEqual(0.4);
      expect(config.temperature).toBeLessThanOrEqual(0.8);
      expect(typeof config.maxTokens).toBe('number');
    }
  });

  it('has 3 SOPs', () => {
    expect(agencyLiteTemplate.sops).toHaveLength(3);
  });

  it('Client Brief Intake SOP has correct structure', () => {
    const sop = agencyLiteTemplate.sops.find((s) => s.sop_id === 'sop-client-brief-intake');
    expect(sop).toBeDefined();
    expect(sop!.steps).toHaveLength(4);
    expect(sop!.steps[0]!.dependencies).toHaveLength(0);
    expect(sop!.steps[1]!.dependencies).toContain('gather-requirements');
    expect(sop!.steps[2]!.dependencies).toContain('scope-and-plan');
    expect(sop!.steps[3]!.dependencies).toContain('creative-direction');
  });

  it('Deliverable Review SOP has correct structure', () => {
    const sop = agencyLiteTemplate.sops.find((s) => s.sop_id === 'sop-deliverable-review');
    expect(sop).toBeDefined();
    expect(sop!.steps).toHaveLength(4);
    expect(sop!.steps[0]!.dependencies).toHaveLength(0);
    expect(sop!.steps[1]!.dependencies).toContain('qa-review');
    expect(sop!.steps[2]!.dependencies).toContain('fix-and-polish');
    expect(sop!.steps[3]!.dependencies).toContain('final-qa');
  });

  it('Social Media Campaign SOP has correct structure', () => {
    const sop = agencyLiteTemplate.sops.find((s) => s.sop_id === 'sop-social-campaign');
    expect(sop).toBeDefined();
    expect(sop!.steps).toHaveLength(5);
    expect(sop!.steps[0]!.dependencies).toHaveLength(0);
    expect(sop!.steps[1]!.dependencies).toContain('campaign-brief');
    expect(sop!.steps[2]!.dependencies).toContain('content-creation');
    expect(sop!.steps[3]!.dependencies).toContain('visual-design');
    expect(sop!.steps[4]!.dependencies).toContain('campaign-review');
  });

  it('employees have distinct character appearances', () => {
    const appearances = agencyLiteTemplate.employees.map((emp) => {
      const persona = JSON.parse(emp.persona_json);
      const cc = persona.characterConfig;
      return `${cc.skinColor}-${cc.hairColor}-${cc.clothingColor}-${cc.hairStyle}`;
    });
    const unique = new Set(appearances);
    expect(unique.size).toBe(appearances.length);
  });

  it('covers the required role slugs', () => {
    const roles = agencyLiteTemplate.employees.map((e) => e.role_slug);
    expect(roles).toContain('account_manager');
    expect(roles).toContain('project_manager');
    expect(roles).toContain('graphic_designer');
    expect(roles).toContain('developer');
    expect(roles).toContain('qa');
  });

  it('uses agency-studio layout preset', () => {
    expect(agencyLiteTemplate.layoutPreset).toBe('agency-studio');
  });
});
