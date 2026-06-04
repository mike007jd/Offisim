export function compactSceneEmployeeName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return truncateLabel(parts[0] ?? name.trim(), 10);

  const first = parts[0] ?? '';
  const last = parts.at(-1) ?? '';
  const suffix = last ? ` ${last.charAt(0)}.` : '';
  return `${truncateLabel(first, Math.max(4, 10 - suffix.length))}${suffix}`;
}

function truncateLabel(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 3))}...`;
}
