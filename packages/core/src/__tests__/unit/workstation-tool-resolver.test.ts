import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolDef } from '../../llm/gateway.js';
import {
  type MemoryRackRepository,
  type MemorySlotRepository,
  type MemoryWorkstationRackRepository,
  createMemoryRepositories,
} from '../../runtime/memory-repositories.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { WorkstationToolResolver } from '../../services/workstation-tool-resolver.js';
import { TEST_COMPANY, TEST_COMPANY_ID, makeEmployee, makeManager } from '../helpers/fixtures.js';

/** A MockToolExecutor that returns a specific set of tools. */
class ConfigurableMockToolExecutor extends MockToolExecutor {
  private readonly _tools: ToolDef[];
  constructor(tools: ToolDef[]) {
    super();
    this._tools = tools;
  }
  override async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return this._tools;
  }
}

describe('WorkstationToolResolver', () => {
  let repos: ReturnType<typeof createMemoryRepositories>;
  let racks: MemoryRackRepository;
  let slots: MemorySlotRepository;
  let workstationRacks: MemoryWorkstationRackRepository;
  let toolExecutor: ConfigurableMockToolExecutor;
  let resolver: WorkstationToolResolver;

  const ALL_TOOLS: ToolDef[] = [
    { name: 'readFile', description: 'Read a file', parameters: {} },
    { name: 'writeFile', description: 'Write a file', parameters: {} },
    { name: 'gitStatus', description: 'Git status', parameters: {} },
    { name: 'deploy', description: 'Deploy app', parameters: {} },
  ];

  beforeEach(async () => {
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);

    racks = repos.racks as MemoryRackRepository;
    slots = repos.slots as MemorySlotRepository;
    workstationRacks = repos.workstationRacks as MemoryWorkstationRackRepository;
    toolExecutor = new ConfigurableMockToolExecutor(ALL_TOOLS);

    resolver = new WorkstationToolResolver({
      employees: repos.employees,
      racks,
      slots,
      workstationRacks,
      toolExecutor,
    });
  });

  it('returns empty tools for employee with no workstation', async () => {
    const emp = makeEmployee({ workstation_id: null });
    repos.seed.employees([emp]);

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(0);
  });

  it('returns all tools for system agent (manager) regardless of workstation', async () => {
    const mgr = makeManager({ workstation_id: null });
    repos.seed.employees([mgr]);

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, mgr.employee_id);
    expect(tools).toHaveLength(4);
  });

  it('returns all tools for hr role regardless of workstation', async () => {
    const hr = makeEmployee({ employee_id: 'e-hr-1', role_slug: 'hr', workstation_id: null });
    repos.seed.employees([hr]);

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, hr.employee_id);
    expect(tools).toHaveLength(4);
  });

  it('returns filtered tools based on workstation rack bindings', async () => {
    // Set up: employee at workstation ws-1
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    // Create a bound rack with 2 slots
    await racks.create({
      rack_id: 'rack-fs',
      company_id: TEST_COMPANY_ID,
      provider_type: 'fs',
      label: 'Filesystem',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-1',
      rack_id: 'rack-fs',
      capability_name: 'readFile',
      exposure_scope: 'company',
      status: 'available',
    });
    await slots.create({
      slot_id: 'slot-2',
      rack_id: 'rack-fs',
      capability_name: 'writeFile',
      exposure_scope: 'company',
      status: 'available',
    });

    // Bind rack to workstation
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-fs' });

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['readFile', 'writeFile']);
  });

  it('excludes tools from unbound racks', async () => {
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    // Create an UNBOUND rack
    await racks.create({
      rack_id: 'rack-unbound',
      company_id: TEST_COMPANY_ID,
      provider_type: 'git',
      label: 'Git',
      binding_profile_json: null,
      status: 'unbound',
    });
    await slots.create({
      slot_id: 'slot-git',
      rack_id: 'rack-unbound',
      capability_name: 'gitStatus',
      exposure_scope: 'company',
      status: 'available',
    });
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-unbound' });

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(0);
  });

  it('excludes unavailable slots', async () => {
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    await racks.create({
      rack_id: 'rack-fs',
      company_id: TEST_COMPANY_ID,
      provider_type: 'fs',
      label: 'Filesystem',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-read',
      rack_id: 'rack-fs',
      capability_name: 'readFile',
      exposure_scope: 'company',
      status: 'available',
    });
    await slots.create({
      slot_id: 'slot-write-disabled',
      rack_id: 'rack-fs',
      capability_name: 'writeFile',
      exposure_scope: 'company',
      status: 'disabled',
    });
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-fs' });

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('readFile');
  });

  it('returns empty for nonexistent employee', async () => {
    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, 'does-not-exist');
    expect(tools).toHaveLength(0);
  });

  it('aggregates tools from multiple racks on one workstation', async () => {
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    // Rack 1: filesystem
    await racks.create({
      rack_id: 'rack-fs',
      company_id: TEST_COMPANY_ID,
      provider_type: 'fs',
      label: 'Filesystem',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-read',
      rack_id: 'rack-fs',
      capability_name: 'readFile',
      exposure_scope: 'company',
      status: 'available',
    });

    // Rack 2: git
    await racks.create({
      rack_id: 'rack-git',
      company_id: TEST_COMPANY_ID,
      provider_type: 'git',
      label: 'Git',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-git',
      rack_id: 'rack-git',
      capability_name: 'gitStatus',
      exposure_scope: 'company',
      status: 'available',
    });

    // Bind both racks to workstation
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-fs' });
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-git' });

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['gitStatus', 'readFile']);
  });

  it('isToolAccessible returns correct results', async () => {
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    await racks.create({
      rack_id: 'rack-fs',
      company_id: TEST_COMPANY_ID,
      provider_type: 'fs',
      label: 'Filesystem',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-read',
      rack_id: 'rack-fs',
      capability_name: 'readFile',
      exposure_scope: 'company',
      status: 'available',
    });
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-fs' });

    expect(await resolver.isToolAccessible(TEST_COMPANY_ID, emp.employee_id, 'readFile')).toBe(
      true,
    );
    expect(await resolver.isToolAccessible(TEST_COMPANY_ID, emp.employee_id, 'deploy')).toBe(false);
  });

  it('workstation with no rack bindings returns empty tools', async () => {
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    const tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(0);
  });

  it('reassignment to new workstation immediately changes tool access', async () => {
    // Employee starts at ws-1 with readFile
    const emp = makeEmployee({ workstation_id: 'ws-1' });
    repos.seed.employees([emp]);

    await racks.create({
      rack_id: 'rack-fs',
      company_id: TEST_COMPANY_ID,
      provider_type: 'fs',
      label: 'Filesystem',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-read',
      rack_id: 'rack-fs',
      capability_name: 'readFile',
      exposure_scope: 'company',
      status: 'available',
    });
    await workstationRacks.create({ workstation_id: 'ws-1', rack_id: 'rack-fs' });

    // ws-2 has deploy tool
    await racks.create({
      rack_id: 'rack-deploy',
      company_id: TEST_COMPANY_ID,
      provider_type: 'deploy',
      label: 'Deploy',
      binding_profile_json: null,
      status: 'bound',
    });
    await slots.create({
      slot_id: 'slot-deploy',
      rack_id: 'rack-deploy',
      capability_name: 'deploy',
      exposure_scope: 'company',
      status: 'available',
    });
    await workstationRacks.create({ workstation_id: 'ws-2', rack_id: 'rack-deploy' });

    // Initially at ws-1
    let tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools.map((t) => t.name)).toEqual(['readFile']);

    // Move to ws-2
    await repos.employees.update(emp.employee_id, { workstation_id: 'ws-2' });

    tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools.map((t) => t.name)).toEqual(['deploy']);

    // Unassign
    await repos.employees.update(emp.employee_id, { workstation_id: null });

    tools = await resolver.resolveForEmployee(TEST_COMPANY_ID, emp.employee_id);
    expect(tools).toHaveLength(0);
  });
});
