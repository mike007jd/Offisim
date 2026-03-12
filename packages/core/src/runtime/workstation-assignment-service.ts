import type { EventBus } from '../events/event-bus.js';
import { employeeWorkstationChanged } from '../events/event-factories.js';
import type { EmployeeRepository } from './repositories.js';

/**
 * Service for assigning employees to workstations.
 *
 * Encapsulates the update + event-emission logic so that both the
 * renderer's drag-drop path and the DOM dropdown path share one
 * authoritative codepath.
 */
export class WorkstationAssignmentService {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Assign (or unassign) an employee to a workstation.
   *
   * @param employeeId - The employee to reassign.
   * @param workstationId - Target workstation ID, or `null` to unassign.
   * @throws If the employee does not exist.
   */
  async assignToWorkstation(employeeId: string, workstationId: string | null): Promise<void> {
    const employee = await this.employees.findById(employeeId);
    if (!employee) {
      throw new Error(`Employee ${employeeId} not found`);
    }

    const oldWorkstationId = employee.workstation_id;

    // No-op if already at the same workstation
    if (oldWorkstationId === workstationId) return;

    await this.employees.update(employeeId, { workstation_id: workstationId });

    this.eventBus.emit(
      employeeWorkstationChanged(employee.company_id, employeeId, oldWorkstationId, workstationId),
    );
  }
}
