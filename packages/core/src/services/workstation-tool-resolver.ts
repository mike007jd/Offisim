import type { RoleSlug } from '@aics/shared-types';
import { SYSTEM_ROLES } from '@aics/shared-types';

import type { ToolDef } from '../llm/gateway.js';
import type {
  EmployeeRepository,
  RackRepository,
  SlotRepository,
  WorkstationRackRepository,
} from '../runtime/repositories.js';
import type { ToolExecutor } from '../runtime/tool-executor.js';

export interface WorkstationToolResolverDeps {
  readonly employees: EmployeeRepository;
  readonly racks: RackRepository;
  readonly slots: SlotRepository;
  readonly workstationRacks: WorkstationRackRepository;
  readonly toolExecutor: ToolExecutor;
}

/**
 * Resolves which MCP tools an employee can access based on the
 * Rack -> Slot -> Workstation permission chain (PRD 2.3).
 *
 * Permission flow:
 * 1. Look up the employee's current `workstation_id`
 * 2. If no workstation -> return empty (unless system agent)
 * 3. Get the workstation's bound rack IDs via `workstation_racks`
 * 4. For each bound rack that is 'bound' status, get its 'available' slots
 * 5. Collect slot capability_names -> these are the allowed tool names
 * 6. Filter the full MCP tool list to only those matching allowed names
 *
 * System agents (manager, hr, pm, boss) bypass this and get all company tools.
 */
export class WorkstationToolResolver {
  private readonly employees: EmployeeRepository;
  private readonly racks: RackRepository;
  private readonly slots: SlotRepository;
  private readonly workstationRacks: WorkstationRackRepository;
  private readonly toolExecutor: ToolExecutor;

  constructor(deps: WorkstationToolResolverDeps) {
    this.employees = deps.employees;
    this.racks = deps.racks;
    this.slots = deps.slots;
    this.workstationRacks = deps.workstationRacks;
    this.toolExecutor = deps.toolExecutor;
  }

  /**
   * Resolve the MCP tools available to a specific employee.
   *
   * @returns Filtered ToolDef[] based on workstation assignment, or all tools
   *          for system agents.
   */
  async resolveForEmployee(companyId: string, employeeId: string): Promise<ToolDef[]> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) return [];

    // System agents get company-wide tool access
    if (SYSTEM_ROLES.has(employee.role_slug as RoleSlug)) {
      return this.toolExecutor.listAvailable(companyId);
    }

    // No workstation assignment -> no MCP tools
    if (!employee.workstation_id) {
      return [];
    }

    // Get the racks bound to this workstation
    const workstationRackBindings = await this.workstationRacks.findByWorkstation(
      employee.workstation_id,
    );

    if (workstationRackBindings.length === 0) {
      return [];
    }

    // Collect allowed capability names from bound racks' available slots
    const allowedCapabilities = new Set<string>();

    for (const binding of workstationRackBindings) {
      const rack = await this.racks.findById(binding.rack_id);
      if (!rack || rack.status !== 'bound') continue;

      const slots = await this.slots.findByRack(rack.rack_id);
      for (const slot of slots) {
        if (slot.status === 'available') {
          allowedCapabilities.add(slot.capability_name);
        }
      }
    }

    if (allowedCapabilities.size === 0) {
      return [];
    }

    // Filter the full tool list to only allowed capabilities
    const allTools = await this.toolExecutor.listAvailable(companyId);
    return allTools.filter((tool) => allowedCapabilities.has(tool.name));
  }

  /** Check if a specific tool is accessible for an employee. */
  async isToolAccessible(
    companyId: string,
    employeeId: string,
    toolName: string,
  ): Promise<boolean> {
    const tools = await this.resolveForEmployee(companyId, employeeId);
    return tools.some((t) => t.name === toolName);
  }
}
