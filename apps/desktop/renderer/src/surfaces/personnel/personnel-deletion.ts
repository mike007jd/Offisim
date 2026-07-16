export function nextEmployeeIdAfterDelete(
  employeeIds: readonly string[],
  deletedEmployeeId: string,
): string | null {
  const deletedIndex = employeeIds.indexOf(deletedEmployeeId);
  if (deletedIndex < 0) return employeeIds[0] ?? null;
  return employeeIds[deletedIndex + 1] ?? employeeIds[deletedIndex - 1] ?? null;
}
