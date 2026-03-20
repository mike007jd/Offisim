export const ROLE_OPTIONS = [
  { value: 'pm', label: 'Product Manager' },
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'qa', label: 'QA Engineer' },
  { value: 'devops', label: 'DevOps Engineer' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'engineering_manager', label: 'Engineering Manager' },
] as const;

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
);
