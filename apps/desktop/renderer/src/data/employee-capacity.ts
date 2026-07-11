export const MAX_COMPANY_EMPLOYEES = 16;

export const EMPLOYEE_CAPACITY_MESSAGE =
  'This company already has the maximum of 16 employees. Remove one before adding another.';

export function assertCompanyEmployeeCapacity(currentCount: number): void {
  if (currentCount >= MAX_COMPANY_EMPLOYEES) throw new Error(EMPLOYEE_CAPACITY_MESSAGE);
}
