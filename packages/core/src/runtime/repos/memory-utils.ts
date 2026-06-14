export function now(): string {
  return new Date().toISOString();
}

export function cloneRow<T extends object>(row: T): T {
  return { ...row };
}

export function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map(cloneRow);
}
